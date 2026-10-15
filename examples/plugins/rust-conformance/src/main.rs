use std::{collections::{BTreeSet, BTreeMap}, env, fs::{File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}, str::FromStr, sync::{Arc, Mutex}, time::Duration};
use bigdecimal::BigDecimal;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{body::{Bytes, Incoming}, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::de::{self, MapAccess, Visitor};
use serde_json::{Value, json, value::RawValue};
use sha2::{Sha256, Digest};
use subtle::ConstantTimeEq;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const CONTROL: &str = "digital-card-plugin@1";
const ACTION: &str = "digital-card-action@1";
const COMMANDS: &[&str] = &["inventory.read", "catalog.read", "purchase.quote", "purchase.register", "purchase.pending", "purchase.execute", "purchase.acknowledge"];
fn check(condition: bool) -> Result<()> { if condition { Ok(()) } else { Err("CONTRACT".into()) } }
fn text(value: &Value) -> Result<&str> { value.as_str().ok_or("STRING".into()) }
fn object(value: &Value) -> Result<&serde_json::Map<String, Value>> { value.as_object().ok_or("OBJECT".into()) }
fn array(value: &Value) -> Result<&Vec<Value>> { value.as_array().ok_or("ARRAY".into()) }
fn integer(value: &Value, min: u64, max: u64) -> Result<u64> { let n=value.as_u64().ok_or("INTEGER")?; check(n>=min && n<=max)?; Ok(n) }
fn fields(value: &Value, names: &str) -> Result<()> { let expected:BTreeSet<_>=names.split(' ').collect(); check(object(value)?.keys().map(String::as_str).collect::<BTreeSet<_>>()==expected) }
fn reserved(value: &str) -> bool { ["__proto__", "prototype", "constructor"].contains(&value) }
fn id(value: &Value) -> bool { value.as_str().is_some_and(|s| !s.is_empty() && s.len()<=100 && !reserved(s) && s.as_bytes()[0].is_ascii_alphanumeric() && s.bytes().all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))) }
fn uuid(value: &Value) -> bool { value.as_str().is_some_and(|s| Uuid::parse_str(s).is_ok_and(|u| u.get_version_num()==4 && u.to_string()==s)) }
fn token(value: &Value) -> bool { value.as_str().is_some_and(|s| s.len()==43 && s.bytes().all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))) }
fn hex64(value: &Value) -> bool { value.as_str().is_some_and(|s| s.len()==64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))) }
fn environment(name: &str, fallback: &str) -> String { env::var(name).unwrap_or_else(|_| fallback.into()) }
fn credential() -> Result<String> { let value=environment("PLUGIN_TOKEN", ""); check((16..=4096).contains(&value.len()) && value.bytes().all(|c| (33..=126).contains(&c)))?; Ok(value) }
fn digest(value: &Value) -> String { Sha256::digest(serde_json::to_vec(value).expect("JSON value")).iter().map(|byte|format!("{byte:02x}")).collect() }

// Serde parses syntax and Unicode; this visitor preserves object entries until duplicate checks.
struct RawObject(Vec<(String, Box<RawValue>)>);
impl<'de> serde::Deserialize<'de> for RawObject {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer:D) -> std::result::Result<Self,D::Error> {
        struct ObjectVisitor;
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value=RawObject;
            fn expecting(&self,f:&mut std::fmt::Formatter)->std::fmt::Result { f.write_str("an object") }
            fn visit_map<A:MapAccess<'de>>(self,mut map:A)->std::result::Result<Self::Value,A::Error> {
                let mut rows=Vec::new();let mut keys=BTreeSet::new();
                while let Some((key,value))=map.next_entry::<String,Box<RawValue>>()? {
                    if !keys.insert(key.clone()) { return Err(de::Error::custom("duplicate key")); }
                    rows.push((key,value));
                }
                Ok(RawObject(rows))
            }
        }
        deserializer.deserialize_map(ObjectVisitor)
    }
}
fn parse(raw: &[u8], journal: bool) -> Result<Value> {
    let source=std::str::from_utf8(raw).map_err(|_| "UTF8")?;
    fn value(source:&str,depth:usize,nodes:&mut usize,journal:bool)->Result<Value> {
        *nodes+=1;check(depth<=if journal {20} else {16} && *nodes<=if journal {1_000_000} else {20_000})?;
        let raw:Box<RawValue>=serde_json::from_str(source).map_err(|_| "JSON")?;
        let source=raw.get().trim();
        if source.starts_with('{') {
            let RawObject(rows)=serde_json::from_str(source).map_err(|_| "JSON_OBJECT")?;
            let mut result=serde_json::Map::new();
            for (key,raw) in rows {check(!reserved(&key) || journal && depth==1)?;result.insert(key,value(raw.get(),depth+1,nodes,journal)?);}
            Ok(Value::Object(result))
        } else if source.starts_with('[') {
            let rows:Vec<Box<RawValue>>=serde_json::from_str(source).map_err(|_| "JSON_ARRAY")?;
            Ok(Value::Array(rows.iter().map(|raw|value(raw.get(),depth+1,nodes,journal)).collect::<Result<_>>()?))
        } else {
            let mut result:Value=serde_json::from_str(source).map_err(|_| "JSON_SCALAR")?;
            if result.is_number() {
                check(source.len()<=500)?;
                if let Some(index)=source.find(['e','E']) { let exponent:i64=source[index+1..].parse().map_err(|_| "EXPONENT")?;check((-400..=400).contains(&exponent))?; }
                let number=BigDecimal::from_str(source).map_err(|_| "DECIMAL")?;
                let (digits,scale)=number.as_bigint_and_exponent();check((-800..=800).contains(&scale) && digits.to_string().trim_start_matches('-').len()<=500)?;
                let canonical=number.normalized().to_plain_string();
                result=Value::Number(serde_json::Number::from_str(&canonical).map_err(|_| "NUMBER")?);
            }
            Ok(result)
        }
    }
    value(source,0,&mut 0,journal)
}

struct Client { base:reqwest::Url, token:String, delegation:String, plugin:String, version:String, http:reqwest::Client, session:Option<String> }
impl Client {
    fn new()->Result<Self> {
        let base=reqwest::Url::parse(&environment("PLUGIN_CONTROL_URL", "")).map_err(|_| "URL")?;
        check(base.username().is_empty() && base.password().is_none() && base.query().is_none() && base.fragment().is_none() && base.path()=="/" && (base.scheme()=="https" || base.scheme()=="http" && ["localhost","127.0.0.1","[::1]"].contains(&base.host_str().unwrap_or(""))))?;
        let delegation=environment("PLUGIN_DELEGATION", "");check(token(&json!(delegation)))?;
        Ok(Self{base,token:credential()?,delegation,plugin:environment("PLUGIN_ID","example.reader"),version:environment("PLUGIN_VERSION","1.0.0"),http:reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).no_proxy().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(10)).build().map_err(|_|"HTTP_CLIENT")?,session:None})
    }
    async fn post(&self,path:&str,input:Value,delegated:bool)->Result<Value> {
        let body=serde_json::to_vec(&input).map_err(|_|"JSON")?;check(body.len()<=65536)?;
        let mut request=self.http.post(self.base.join(path).map_err(|_|"URL")?).header("content-type","application/json").bearer_auth(&self.token).body(body);
        if delegated { request=request.header("X-DC-Delegation",&self.delegation); }
        let mut response=request.send().await.map_err(|_|"PLUGIN_REQUEST")?;
        check(response.headers().get("content-type").and_then(|v|v.to_str().ok()).unwrap_or("").split(';').next()==Some("application/json"))?;
        let status=response.status();let mut raw=Vec::new();
        while let Some(part)=response.chunk().await.map_err(|_|"PLUGIN_RESPONSE")? { check(raw.len()+part.len()<=1048576)?;raw.extend_from_slice(&part); }
        let result=parse(&raw,false)?;check(result["protocol"]==CONTROL && status==200)?;Ok(result)
    }
    async fn run(&mut self,input:Value)->Result<Value> {
        fields(&input,"command input")?;let command=text(&input["command"])?;check(COMMANDS.contains(&command))?;object(&input["input"])?;
        let ready=self.post("/plugins/handshake",json!({"protocol":CONTROL,"pluginId":self.plugin,"version":self.version}),false).await?;
        fields(&ready,"protocol pluginId version sessionId expiresAt generation commands quotas")?;
        check(ready["pluginId"]==self.plugin && ready["version"]==self.version && token(&ready["sessionId"]))?;self.session=Some(text(&ready["sessionId"])?.into());
        integer(&ready["generation"],1,9007199254740991)?;check(text(&ready["expiresAt"])?.len()<=64)?;
        let grants=array(&ready["commands"])?;let mut seen=BTreeSet::new();for grant in grants { let grant=text(grant)?;check(COMMANDS.contains(&grant) && seen.insert(grant))?; }check(seen.contains(command))?;
        fields(&ready["quotas"],"maxRequestBytes maxResponseBytes concurrency timeoutMs")?;
        for (name,max) in [("maxRequestBytes",1048576),("maxResponseBytes",33554432),("concurrency",32),("timeoutMs",300000)] {integer(&ready["quotas"][name],1,max)?;}
        let request_id=Uuid::new_v4().to_string();
        let result=self.post("/plugins/commands",json!({"protocol":CONTROL,"sessionId":self.session,"requestId":request_id,"command":command,"input":input["input"]}),true).await?;
        fields(&result,"protocol requestId command result")?;check(result["requestId"]==request_id && result["command"]==command)?;object(&result["result"])?;Ok(result["result"].clone())
    }
    async fn close(&self)->Result<()> { if let Some(session)=&self.session {let result=self.post("/plugins/sessions/close",json!({"protocol":CONTROL,"sessionId":session}),false).await?;check(result==json!({"protocol":CONTROL,"sessionId":session,"status":"closed"}))?;}Ok(()) }
}

struct Journal { receipts:serde_json::Map<String,Value>, poisoned:bool }
struct Service { token:String,provider:String,actors:BTreeMap<String,Value>,path:PathBuf,_lock:File,capacity:usize,journal:Mutex<Journal> }
fn validate_action(request:&Value)->Result<()> {
    fields(request,"protocol pluginId handlerId jobId beneficiaryId source params")?;
    check(request["protocol"]==ACTION && request["pluginId"]=="example.receiver" && request["handlerId"]=="example.record")?;
    let job=text(&request["jobId"])?;check((1..=128).contains(&job.encode_utf16().count()) && (request["beneficiaryId"].is_null() || request["beneficiaryId"].is_string()))?;
    object(&request["source"])?;object(&request["params"])?;Ok(())
}
fn bounded_file(path:&Path,limit:u64)->Result<Vec<u8>> {let mut raw=Vec::new();File::open(path).map_err(|_|"FILE")?.take(limit+1).read_to_end(&mut raw).map_err(|_|"READ")?;check(raw.len() as u64<=limit)?;Ok(raw)}
impl Service {
    fn new(records:&Path,path:PathBuf)->Result<Self> {
        let provider=environment("TRANSFER_POLICY_PROVIDER_ID","example.transfer");check(id(&json!(provider)))?;
        let capacity:usize=environment("PLUGIN_MAX_RECEIPTS","1000").parse().map_err(|_|"CAPACITY")?;check((1..=10000).contains(&capacity))?;
        let config=parse(&bounded_file(records,65536)?,false)?;fields(&config,"actors")?;let rows=array(&config["actors"])?;check(rows.len()<=100)?;let mut actors=BTreeMap::new();
        for actor in rows {fields(actor,"id recipientIds allowListingReservation")?;check(id(&actor["id"]) && actor["allowListingReservation"].is_boolean())?;let recipients=array(&actor["recipientIds"])?;let mut seen=BTreeSet::new();check(recipients.len()<=100)?;for recipient in recipients {check(id(recipient) && seen.insert(text(recipient)?))?;}check(actors.insert(text(&actor["id"])?.into(),actor.clone()).is_none())?;}
        let lock=OpenOptions::new().read(true).write(true).create(true).truncate(false).open(format!("{}.lock",path.display())).map_err(|_|"LOCK")?;lock.try_lock().map_err(|_|"LOCK")?;
        let mut receipts=serde_json::Map::new();
        if path.exists() {let saved=parse(&bounded_file(&path,4194304)?,true)?;fields(&saved,"version receipts")?;integer(&saved["version"],1,1)?;let rows=object(&saved["receipts"])?;check(rows.len()<=10000)?;
            for (key,row) in rows {fields(row,"digest payload")?;validate_action(&row["payload"])?;check(row["payload"]["jobId"]==*key && row["digest"]==digest(&row["payload"]))?;receipts.insert(key.clone(),row.clone());}
        }
        Ok(Self{token:credential()?,provider,actors,path,_lock:lock,capacity,journal:Mutex::new(Journal{receipts,poisoned:false})})
    }
    fn persist(&self,raw:&[u8])->Result<()> {
        let parent=self.path.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let mut temporary=tempfile::NamedTempFile::new_in(parent).map_err(|_|"TEMPFILE")?;temporary.write_all(raw).map_err(|_|"WRITE")?;temporary.as_file().sync_all().map_err(|_|"SYNC")?;temporary.persist(&self.path).map_err(|_|"REPLACE")?;Ok(())
    }
    fn action(&self,request:Value,key:&str)->std::result::Result<Value,u16> {
        validate_action(&request).map_err(|_|400u16)?;if request["jobId"]!=key{return Err(400);}
        let mut journal=self.journal.lock().map_err(|_|503u16)?;if journal.poisoned{return Err(503);}
        let hash=digest(&request);
        if let Some(row)=journal.receipts.get(key) {if row["digest"]!=hash{return Err(409);}}
        else {
            if journal.receipts.len()>=self.capacity{return Err(507);}
            journal.receipts.insert(key.into(),json!({"digest":hash,"payload":request}));
            let raw=match serde_json::to_vec(&json!({"version":1,"receipts":journal.receipts})) {Ok(raw) if raw.len()<=4194304 && parse(&raw,true).is_ok()=>raw,_=>{journal.receipts.remove(key);return Err(507);}};
            if self.persist(&raw).is_err(){journal.poisoned=true;return Err(503);}
        }
        Ok(json!({"protocol":ACTION,"pluginId":"example.receiver","jobId":key,"status":"completed"}))
    }
    fn transfer(&self,request:Value)->Result<Value> {
        fields(&request,"protocol operation scope phase requestId providerId grantId generation commandId inputDigest snapshotDigest deadline context")?;
        check(request["protocol"]=="digital-card-transfer-policy@1" && request["operation"]=="canTransfer" && request["scope"]=="transfer" && request["providerId"]==self.provider && uuid(&request["requestId"]) && uuid(&request["grantId"]))?;
        integer(&request["generation"],1,9007199254740991)?;integer(&request["deadline"],1,9007199254740991)?;
        for name in ["commandId","inputDigest","snapshotDigest"] {check(hex64(&request[name]))?;}
        check(["review","propose","counter","accept","list","quote","purchase"].contains(&text(&request["phase"])?))?;
        let context=&request["context"];fields(context,"channel legs")?;check(["trade","sale"].contains(&text(&context["channel"])?))?;let legs=array(&context["legs"])?;check((1..=2).contains(&legs.len()))?;let mut seen=BTreeSet::new();let mut allowed=true;
        for leg in legs {fields(leg,"fromUserId toUserId copyIds versions")?;check(id(&leg["fromUserId"]) && (leg["toUserId"].is_null() || id(&leg["toUserId"])))?;let copies=array(&leg["copyIds"])?;let versions=array(&leg["versions"])?;check(!copies.is_empty() && copies.len()==versions.len())?;
            for (copy,version) in copies.iter().zip(versions) {check(uuid(copy) && seen.insert(text(copy)?))?;integer(version,1,9007199254740991)?;}
            allowed &= match self.actors.get(text(&leg["fromUserId"])?) {None=>false,Some(actor)=>if leg["toUserId"].is_null(){actor["allowListingReservation"]==true}else{array(&actor["recipientIds"])?.contains(&leg["toUserId"])}};
        }
        check(seen.len()<=2000)?;let mut result=object(&request)?.clone();result.remove("context");result.insert("status".into(),json!(if allowed{"allowed"}else{"denied"}));if !allowed{result.insert("reasonCode".into(),json!("restricted"));}Ok(Value::Object(result))
    }
    async fn handle(self:Arc<Self>,request:Request<Incoming>)->std::result::Result<Response<Full<Bytes>>,std::convert::Infallible> {
        let response=|status:u16,value:Value|Response::builder().status(StatusCode::from_u16(status).unwrap()).header("content-type","application/json").header("cache-control","no-store").body(Full::new(Bytes::from(serde_json::to_vec(&value).unwrap()))).unwrap();
        let auth:Vec<_>=request.headers().get_all("authorization").iter().collect();let expected=format!("Bearer {}",self.token);
        if auth.len()!=1 || !bool::from(auth[0].as_bytes().ct_eq(expected.as_bytes())) {return Ok(response(403,json!({})));}
        if request.method()!=hyper::Method::POST || request.uri().query().is_some() {return Ok(response(400,json!({})));}
        let path=request.uri().path().to_string();if !["/actions","/transfer-policy"].contains(&path.as_str()){return Ok(response(404,json!({})));}
        if request.headers().get("content-type").and_then(|v|v.to_str().ok()).unwrap_or("").split(';').next()!=Some("application/json") || request.headers().contains_key("content-encoding") {return Ok(response(400,json!({})));}
        let key=request.headers().get("idempotency-key").and_then(|v|v.to_str().ok()).unwrap_or("").to_string();
        let raw=match tokio::time::timeout(Duration::from_secs(10),Limited::new(request.into_body(),65536).collect()).await {Ok(Ok(body))=>body.to_bytes(),Ok(Err(_))=>return Ok(response(413,json!({}))),Err(_)=>return Ok(response(408,json!({})))};
        let input=match parse(&raw,false){Ok(value)=>value,Err(_)=>return Ok(response(400,json!({})))};
        let result=if path=="/actions"{self.action(input,&key)}else{self.transfer(input).map_err(|_|400)};
        Ok(match result{Ok(value)=>response(200,value),Err(status)=>response(status,json!({}))})
    }
}
async fn run()->Result<()> {
    let args:Vec<_>=env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("client") if args.len()==1=>{let mut raw=Vec::new();std::io::stdin().take(65537).read_to_end(&mut raw).map_err(|_|"STDIN")?;check(raw.len()<=65536)?;let input=parse(&raw,false)?;let mut client=Client::new()?;let result=client.run(input).await;let closed=client.close().await;let value=result?;closed?;println!("{}",serde_json::to_string(&value).map_err(|_|"JSON")?);Ok(())}
        Some("serve") if args.len()==3=>{
            let service=Arc::new(Service::new(Path::new(&args[1]),PathBuf::from(&args[2]))?);let listener=tokio::net::TcpListener::bind(("127.0.0.1",0)).await.map_err(|_|"LISTEN")?;println!("{}",listener.local_addr().map_err(|_|"LISTEN")?.port());
            let permits=Arc::new(tokio::sync::Semaphore::new(8));
            loop {let permit=permits.clone().acquire_owned().await.map_err(|_|"CAPACITY")?;let (stream,_)=listener.accept().await.map_err(|_|"ACCEPT")?;let service=service.clone();tokio::spawn(async move{let _permit=permit;let mut builder=hyper::server::conn::http1::Builder::new();builder.timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(10)).keep_alive(false);let connection=builder.serve_connection(TokioIo::new(stream),hyper::service::service_fn(move|request|service.clone().handle(request)));let _=tokio::time::timeout(Duration::from_secs(15),connection).await;});}
        }
        _=>Err("USAGE".into())
    }
}
#[tokio::main(flavor="multi_thread",worker_threads=2)]
async fn main(){if run().await.is_err(){eprintln!("CONFORMANCE_FAILED");std::process::exit(1);}}
