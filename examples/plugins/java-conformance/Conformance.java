import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.math.BigDecimal;
import java.net.*;
import java.net.http.*;
import java.nio.*;
import java.nio.channels.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

/** Small standard-library examples of three existing wire contracts. */
class Conformance {
  static final String CONTROL="digital-card-plugin@1", ACTION="digital-card-action@1";
  static final Set<String> COMMANDS=Set.of("inventory.read","catalog.read","purchase.quote","purchase.register","purchase.pending","purchase.execute","purchase.acknowledge");
  static final String ID="[A-Za-z0-9][A-Za-z0-9._:-]{0,99}", UUID="[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}", TOKEN="[A-Za-z0-9_-]{43}";
  static final Set<String> RESERVED=Set.of("__proto__","prototype","constructor");
  static void require(boolean condition){if(!condition)throw new IllegalArgumentException("CONTRACT");}
  static Map<String,Object> object(Object value){require(value instanceof Map);return (Map<String,Object>)value;}
  static List<Object> array(Object value){require(value instanceof List);return (List<Object>)value;}
  static boolean matches(Object value,String expression){return value instanceof String&&((String)value).matches(expression);}
  static boolean id(Object value){return matches(value,ID)&&!RESERVED.contains(value);}
  static boolean oneOf(Object value,String... choices){return value instanceof String&&List.of(choices).contains(value);}
  static void fields(Object value,String names){require(object(value).keySet().equals(Set.of(names.split(" "))));}
  static long integer(Object value,long min,long max){require(value instanceof BigDecimal);try{long number=((BigDecimal)value).longValueExact();require(number>=min&&number<=max);return number;}catch(ArithmeticException error){throw new IllegalArgumentException("INTEGER");}}
  static String env(String name,String fallback){return System.getenv().getOrDefault(name,fallback);}
  static String credential(String name){String token=env(name,"");require(token.matches("[!-~]{16,4096}"));return token;}
  static String digest(String value)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}

  // Exact decimals and sorted object keys make equivalent receipt terms replayable.
  static class Json {
    String text;int offset,nodes,maxDepth=16,maxNodes=20000;
    Json(byte[] raw){try{text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString();}catch(CharacterCodingException error){throw new IllegalArgumentException("UTF8");}}
    static Object parse(byte[] raw)throws Exception{Json parser=new Json(raw);Object value=parser.value(0);parser.space();require(parser.offset==parser.text.length());return value;}
    static Object journal(byte[] raw)throws Exception{Json parser=new Json(raw);parser.maxDepth=20;parser.maxNodes=1000000;Object value=parser.value(0);parser.space();require(parser.offset==parser.text.length());return value;}
    void space(){while(offset<text.length()&&" \r\n\t".indexOf(text.charAt(offset))>=0)offset++;}
    char take(){require(offset<text.length());return text.charAt(offset++);}
    Object value(int depth){require(depth<=maxDepth&&++nodes<=maxNodes);space();require(offset<text.length());char c=text.charAt(offset);
      if(c=='"')return string();
      if(c=='{'||c=='['){offset++;boolean map=c=='{';Map<String,Object> result=new TreeMap<>();List<Object> list=new ArrayList<>();space();char close=map?'}':']';if(offset<text.length()&&text.charAt(offset)==close){offset++;return map?result:list;}
        while(true){if(map){space();require(offset<text.length()&&text.charAt(offset)=='"');String key=string();require(!RESERVED.contains(key)&&!result.containsKey(key));space();require(take()==':');result.put(key,value(depth+1));}else list.add(value(depth+1));space();char end=take();if(end==close)return map?result:list;require(end==',');}}
      for(String literal:List.of("true","false","null"))if(text.startsWith(literal,offset)){offset+=literal.length();return literal.equals("null")?null:literal.equals("true");}
      int start=offset;while(offset<text.length()&&"-+0123456789.eE".indexOf(text.charAt(offset))>=0)offset++;String token=text.substring(start,offset);require(token.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")&&token.length()<=500);
      BigDecimal number=new BigDecimal(token);require(Math.abs((long)number.scale())<=800&&number.precision()<=500);int e=Math.max(token.indexOf('e'),token.indexOf('E'));if(e>=0)require(Math.abs(Long.parseLong(token.substring(e+1)))<=400);return number;
    }
    String string(){require(take()=='"');StringBuilder value=new StringBuilder();while(true){char c=take();if(c=='"')break;require(c>=32);if(c=='\\'){c=take();switch(c){case '"':case '\\':case '/':break;case 'b':c='\b';break;case 'f':c='\f';break;case 'n':c='\n';break;case 'r':c='\r';break;case 't':c='\t';break;case 'u':require(offset+4<=text.length());c=(char)Integer.parseInt(text.substring(offset,offset+4),16);offset+=4;break;default:throw new IllegalArgumentException("ESCAPE");}}value.append(c);}
      for(int n=0;n<value.length();n++){char c=value.charAt(n);if(Character.isHighSurrogate(c)){require(n+1<value.length()&&Character.isLowSurrogate(value.charAt(++n)));}else require(!Character.isLowSurrogate(c));}return value.toString();
    }
    static String write(Object value){if(value==null)return "null";if(value instanceof Boolean)return value.toString();if(value instanceof Number){BigDecimal number=value instanceof BigDecimal?(BigDecimal)value:new BigDecimal(value.toString());return number.signum()==0?"0":number.stripTrailingZeros().toPlainString();}
      if(value instanceof String){StringBuilder result=new StringBuilder("\"");for(char c:((String)value).toCharArray()){if(c=='"'||c=='\\')result.append('\\').append(c);else if(c<32)result.append(String.format("\\u%04x",(int)c));else result.append(c);}return result.append('"').toString();}
      if(value instanceof List){List<String> parts=new ArrayList<>();for(Object item:(List<?>)value)parts.add(write(item));return "["+String.join(",",parts)+"]";}
      List<String> parts=new ArrayList<>();for(var entry:new TreeMap<>(object(value)).entrySet())parts.add(write(entry.getKey())+":"+write(entry.getValue()));return "{"+String.join(",",parts)+"}";
    }
  }

  static class Client {
    final String base,token,delegation,plugin,version;
    final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    String session;
    Client(){base=env("PLUGIN_CONTROL_URL","");URI uri=URI.create(base);require(uri.getUserInfo()==null&&uri.getQuery()==null&&uri.getFragment()==null&&(uri.getPath().isEmpty()||uri.getPath().equals("/")));require(uri.getScheme().equals("https")||uri.getScheme().equals("http")&&Set.of("localhost","127.0.0.1","[::1]").contains(uri.getHost()));token=credential("PLUGIN_TOKEN");delegation=env("PLUGIN_DELEGATION","");require(delegation.matches(TOKEN));plugin=env("PLUGIN_ID","example.reader");version=env("PLUGIN_VERSION","1.0.0");}
    Map<String,Object> post(String path,Map<String,Object> value,boolean delegated)throws Exception{
      byte[] body=Json.write(value).getBytes(StandardCharsets.UTF_8);require(body.length<=65536);var builder=HttpRequest.newBuilder(URI.create(base.replaceAll("/$","")+path)).timeout(Duration.ofSeconds(10)).header("content-type","application/json").header("authorization","Bearer "+token).POST(HttpRequest.BodyPublishers.ofByteArray(body));if(delegated)builder.header("X-DC-Delegation",delegation);
      var response=http.send(builder.build(),HttpResponse.BodyHandlers.ofInputStream());try(var input=response.body()){var timer=Executors.newSingleThreadScheduledExecutor(Thread.ofVirtual().factory());var timeout=timer.schedule(()->{try{input.close();}catch(IOException ignored){}},10,TimeUnit.SECONDS);try{require(response.headers().firstValue("content-type").orElse("").split(";")[0].equals("application/json"));byte[] raw=input.readNBytes(1048577);require(raw.length<=1048576);Map<String,Object> result=object(Json.parse(raw));require(CONTROL.equals(result.get("protocol")));if(response.statusCode()!=200)throw new IOException("PLUGIN_REQUEST");return result;}finally{timeout.cancel(false);timer.shutdown();}}
    }
    Object run(Map<String,Object> command)throws Exception{fields(command,"command input");require(COMMANDS.contains(command.get("command")));object(command.get("input"));Map<String,Object> ready=post("/plugins/handshake",Map.of("protocol",CONTROL,"pluginId",plugin,"version",version),false);
      fields(ready,"protocol pluginId version sessionId expiresAt generation commands quotas");require(plugin.equals(ready.get("pluginId"))&&version.equals(ready.get("version"))&&matches(ready.get("sessionId"),TOKEN));session=(String)ready.get("sessionId");integer(ready.get("generation"),1,9007199254740991L);Instant.parse((String)ready.get("expiresAt"));var grants=array(ready.get("commands"));require(new HashSet<>(grants).size()==grants.size()&&COMMANDS.containsAll(grants)&&grants.contains(command.get("command")));var quotas=object(ready.get("quotas"));fields(quotas,"maxRequestBytes maxResponseBytes concurrency timeoutMs");integer(quotas.get("maxRequestBytes"),1,1048576);integer(quotas.get("maxResponseBytes"),1,33554432);integer(quotas.get("concurrency"),1,32);integer(quotas.get("timeoutMs"),1,300000);
      String requestId=java.util.UUID.randomUUID().toString();Map<String,Object> result=post("/plugins/commands",Map.of("protocol",CONTROL,"sessionId",session,"requestId",requestId,"command",command.get("command"),"input",command.get("input")),true);fields(result,"protocol requestId command result");require(requestId.equals(result.get("requestId"))&&command.get("command").equals(result.get("command")));return object(result.get("result"));
    }
    void close()throws Exception{if(session!=null){var result=post("/plugins/sessions/close",Map.of("protocol",CONTROL,"sessionId",session),false);require(result.equals(Map.of("protocol",CONTROL,"sessionId",session,"status","closed")));}}
  }

  static class Service implements AutoCloseable {
    final String token=credential("PLUGIN_TOKEN"),provider=env("TRANSFER_POLICY_PROVIDER_ID","example.transfer");
    final Map<String,Object> actors=new TreeMap<>(),receipts=new TreeMap<>();
    final Path journal;final FileChannel lockChannel;final FileLock lock;boolean poisoned;
    final int capacity=Integer.parseInt(env("PLUGIN_MAX_RECEIPTS","1000"));
    Service(Path records,Path journal)throws Exception{require(id(provider)&&capacity>=1&&capacity<=10000);this.journal=journal;byte[] raw=Files.readAllBytes(records);require(raw.length<=65536);var config=object(Json.parse(raw));fields(config,"actors");require(array(config.get("actors")).size()<=100);for(Object item:array(config.get("actors"))){var actor=object(item);fields(actor,"id recipientIds allowListingReservation");require(id(actor.get("id"))&&!actors.containsKey(actor.get("id"))&&actor.get("allowListingReservation") instanceof Boolean);var recipients=array(actor.get("recipientIds"));require(recipients.size()<=100&&new HashSet<>(recipients).size()==recipients.size());for(Object recipient:recipients)require(id(recipient));actors.put((String)actor.get("id"),actor);}
      lockChannel=FileChannel.open(Path.of(journal+".lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);lock=lockChannel.tryLock();require(lock!=null);
      if(Files.exists(journal)){require(Files.size(journal)<=4194304);var saved=object(Json.journal(Files.readAllBytes(journal)));fields(saved,"version receipts");integer(saved.get("version"),1,1);var rows=object(saved.get("receipts"));require(rows.size()<=10000);for(var row:rows.entrySet()){var receipt=object(row.getValue());fields(receipt,"digest payload");var payload=object(receipt.get("payload"));validateAction(payload);require(row.getKey().equals(payload.get("jobId"))&&digest(Json.write(payload)).equals(receipt.get("digest")));receipts.put(row.getKey(),receipt);}}
    }
    void persist()throws Exception{byte[] bytes=Json.write(Map.of("version",1,"receipts",receipts)).getBytes(StandardCharsets.UTF_8);require(bytes.length<=4194304);Path temporary=Files.createTempFile(journal.toAbsolutePath().getParent(),"java-receipts-",".tmp");try{try(FileChannel file=FileChannel.open(temporary,StandardOpenOption.WRITE)){ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())file.write(buffer);file.force(true);}Files.move(temporary,journal,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}finally{Files.deleteIfExists(temporary);}}
    void validateAction(Map<String,Object> request){fields(request,"protocol pluginId handlerId jobId beneficiaryId source params");require(ACTION.equals(request.get("protocol"))&&"example.receiver".equals(request.get("pluginId"))&&"example.record".equals(request.get("handlerId")));require(matches(request.get("jobId"),"[^\\p{Cntrl}]{1,256}")&&!RESERVED.contains(request.get("jobId"))&&(request.get("beneficiaryId")==null||id(request.get("beneficiaryId"))));object(request.get("source"));object(request.get("params"));}
    synchronized Map<String,Object> action(Map<String,Object> request,String key)throws Exception{if(poisoned)throw new Status(503);validateAction(request);require(request.get("jobId").equals(key));String hash=digest(Json.write(request));if(receipts.containsKey(key)){if(!object(receipts.get(key)).get("digest").equals(hash))throw new Status(409);}else{if(receipts.size()>=capacity)throw new Status(507);receipts.put(key,Map.of("digest",hash,"payload",request));try{persist();}catch(Exception error){poisoned=true;throw error;}}return Map.of("protocol",ACTION,"pluginId","example.receiver","jobId",key,"status","completed");}
    Map<String,Object> transfer(Map<String,Object> request){fields(request,"protocol operation scope phase requestId providerId grantId generation commandId inputDigest snapshotDigest deadline context");require("digital-card-transfer-policy@1".equals(request.get("protocol"))&&"canTransfer".equals(request.get("operation"))&&"transfer".equals(request.get("scope"))&&provider.equals(request.get("providerId"))&&matches(request.get("requestId"),UUID)&&matches(request.get("grantId"),UUID));integer(request.get("generation"),1,9007199254740991L);integer(request.get("deadline"),1,9007199254740991L);for(String field:List.of("commandId","inputDigest","snapshotDigest"))require(matches(request.get(field),"[a-f0-9]{64}"));require(oneOf(request.get("phase"),"review","propose","counter","accept","list","quote","purchase"));var context=object(request.get("context"));fields(context,"channel legs");require(oneOf(context.get("channel"),"trade","sale"));var legs=array(context.get("legs"));require(legs.size()>=1&&legs.size()<=2);Set<Object> seen=new HashSet<>();boolean allowed=true;
      for(Object value:legs){var leg=object(value);fields(leg,"fromUserId toUserId copyIds versions");require(id(leg.get("fromUserId"))&&(leg.get("toUserId")==null||id(leg.get("toUserId"))));var copies=array(leg.get("copyIds"));var versions=array(leg.get("versions"));require(!copies.isEmpty()&&copies.size()==versions.size());for(int n=0;n<copies.size();n++){require(matches(copies.get(n),UUID)&&seen.add(copies.get(n)));integer(versions.get(n),1,9007199254740991L);}var actor=actors.get(leg.get("fromUserId"));allowed&=actor!=null&&(leg.get("toUserId")==null?Boolean.TRUE.equals(object(actor).get("allowListingReservation")):array(object(actor).get("recipientIds")).contains(leg.get("toUserId")));}require(seen.size()<=2000);Map<String,Object> result=new TreeMap<>(request);result.remove("context");result.put("status",allowed?"allowed":"denied");if(!allowed)result.put("reasonCode","restricted");return result;
    }
    void handle(HttpExchange exchange)throws IOException{try{require(exchange.getRequestMethod().equals("POST")&&exchange.getRequestURI().getRawQuery()==null);String path=exchange.getRequestURI().getPath();if(!Set.of("/actions","/transfer-policy").contains(path))throw new Status(404);var auth=exchange.getRequestHeaders().get("Authorization");if(auth==null||auth.size()!=1||!MessageDigest.isEqual(auth.getFirst().getBytes(StandardCharsets.UTF_8),("Bearer "+token).getBytes(StandardCharsets.UTF_8)))throw new Status(403);require(exchange.getRequestHeaders().getFirst("Content-Type")!=null&&exchange.getRequestHeaders().getFirst("Content-Type").split(";")[0].equals("application/json")&&exchange.getRequestHeaders().getFirst("Content-Encoding")==null);byte[] body=exchange.getRequestBody().readNBytes(65537);if(body.length>65536)throw new Status(413);var request=object(Json.parse(body));Object result=path.equals("/actions")?action(request,exchange.getRequestHeaders().getFirst("Idempotency-Key")):transfer(request);reply(exchange,200,result);}catch(Status error){reply(exchange,error.code,Map.of());}catch(IllegalArgumentException error){reply(exchange,400,Map.of());}catch(Exception error){reply(exchange,503,Map.of());}finally{exchange.close();}}
    void reply(HttpExchange exchange,int status,Object value)throws IOException{byte[] bytes=Json.write(value).getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("content-type","application/json");exchange.getResponseHeaders().set("cache-control","no-store");exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);}
    public void close()throws Exception{lock.release();lockChannel.close();}
  }
  static class Status extends RuntimeException{final int code;Status(int code){this.code=code;}}
  public static void main(String[] args){try{require(args.length>=1);if(args[0].equals("client")){byte[] raw=System.in.readNBytes(65537);require(raw.length<=65536);Client client=new Client();Object result;try{result=client.run(object(Json.parse(raw)));}finally{client.close();}System.out.println(Json.write(result));}else{require(args.length==3&&args[0].equals("serve"));System.setProperty("sun.net.httpserver.maxReqTime","10");System.setProperty("sun.net.httpserver.maxRspTime","10");System.setProperty("jdk.httpserver.maxConnections","8");Service service=new Service(Path.of(args[1]),Path.of(args[2]));HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),8);var executor=new ThreadPoolExecutor(2,2,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(8));server.setExecutor(executor);server.createContext("/",service::handle);Runtime.getRuntime().addShutdownHook(new Thread(()->{server.stop(0);executor.shutdownNow();try{service.close();}catch(Exception ignored){}}));server.start();System.out.println(server.getAddress().getPort());}}catch(Exception error){System.err.println("CONFORMANCE_FAILED");System.exit(1);}}
}
