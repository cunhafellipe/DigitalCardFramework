using System.Globalization;
using System.Net;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;

// Finite examples of the existing control, transfer and action wire contracts.
static class Conformance
{
    const string Control="digital-card-plugin@1", Action="digital-card-action@1";
    const string Id="^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$", Uuid="^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", Token="^[A-Za-z0-9_-]{43}$";
    static readonly HashSet<string> Commands=["inventory.read","catalog.read","purchase.quote","purchase.register","purchase.pending","purchase.execute","purchase.acknowledge"];
    static readonly HashSet<string> Reserved=["__proto__","prototype","constructor"];
    static readonly UTF8Encoding Utf8=new(false,true);
    sealed class Contract : Exception;
    sealed class Status(int code) : Exception { public int Code=code; }
    static void Require(bool condition){if(!condition)throw new Contract();}
    static string Env(string name,string fallback)=>Environment.GetEnvironmentVariable(name)??fallback;
    static string Credential(string name){var value=Env(name,"");Require(Regex.IsMatch(value,"^[!-~]{16,4096}$",RegexOptions.CultureInvariant)&&!value.Contains('\n'));return value;}
    static bool Match(JsonElement value,string pattern)=>value.ValueKind==JsonValueKind.String&&Regex.IsMatch(value.GetString()!,pattern,RegexOptions.CultureInvariant)&&!value.GetString()!.Contains('\n');
    static bool Identifier(JsonElement value)=>Match(value,Id)&&!Reserved.Contains(value.GetString()!);
    static bool OneOf(JsonElement value,params string[] values)=>value.ValueKind==JsonValueKind.String&&values.Contains(value.GetString(),StringComparer.Ordinal);
    static JsonElement Get(JsonElement value,string name){Require(value.ValueKind==JsonValueKind.Object&&value.TryGetProperty(name,out _));return value.GetProperty(name);}
    static string Text(JsonElement value){Require(value.ValueKind==JsonValueKind.String);return value.GetString()!;}
    static JsonElement[] Array(JsonElement value){Require(value.ValueKind==JsonValueKind.Array);return value.EnumerateArray().ToArray();}
    static void Object(JsonElement value)=>Require(value.ValueKind==JsonValueKind.Object);
    static void Fields(JsonElement value,string names){Object(value);Require(value.EnumerateObject().Select(item=>item.Name).ToHashSet(StringComparer.Ordinal).SetEquals(names.Split(' ')));}
    static Dictionary<string,object?> Map(params object?[] pairs){var result=new Dictionary<string,object?>(StringComparer.Ordinal);for(int n=0;n<pairs.Length;n+=2)result.Add((string)pairs[n]!,pairs[n+1]);return result;}
    static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Utf8.GetBytes(value))).ToLowerInvariant();
    static long Integer(JsonElement value,long min=1,long max=9007199254740991){Require(value.ValueKind==JsonValueKind.Number);var canonical=Number(value.GetRawText());Require(long.TryParse(canonical,NumberStyles.AllowLeadingSign,CultureInfo.InvariantCulture,out var number)&&number>=min&&number<=max);return number;}

    // Compare exact numeric terms without floating-point or Decimal range loss.
    static string Number(string raw)
    {
        Require(raw.Length<=500);var parts=raw.Split(['e','E']);int exponent=0;
        if(parts.Length==2)Require(int.TryParse(parts[1],NumberStyles.AllowLeadingSign,CultureInfo.InvariantCulture,out exponent)&&exponent>=-400&&exponent<=400);
        string mantissa=parts[0];int dot=mantissa.IndexOf('.'),scale=(dot<0?0:mantissa.Length-dot-1)-exponent;
        var coefficient=BigInteger.Parse(mantissa.Replace(".",""),CultureInfo.InvariantCulture);if(coefficient.IsZero)return "0";
        var negative=coefficient.Sign<0;string digits=BigInteger.Abs(coefficient).ToString(CultureInfo.InvariantCulture);
        while(digits.EndsWith('0')){digits=digits[..^1];scale--;}
        string result=scale<=0?digits+new string('0',-scale):scale>=digits.Length?"0."+new string('0',scale-digits.Length)+digits:digits.Insert(digits.Length-scale,".");
        return negative?"-"+result:result;
    }
    static JsonElement Parse(byte[] bytes,int depth=16,int nodes=20000,bool journal=false)
    {
        _=Utf8.GetString(bytes);using var document=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=depth,CommentHandling=JsonCommentHandling.Disallow,AllowTrailingCommas=false});var value=document.RootElement.Clone();Validate(value,ref nodes,journal);return value;
    }
    static void Unicode(string value){for(int n=0;n<value.Length;n++){if(char.IsHighSurrogate(value[n]))Require(++n<value.Length&&char.IsLowSurrogate(value[n]));else Require(!char.IsLowSurrogate(value[n]));}}
    static void Validate(JsonElement value,ref int budget,bool journal=false,int depth=0)
    {
        Require(--budget>=0);
        if(value.ValueKind==JsonValueKind.Object){var keys=new HashSet<string>(StringComparer.Ordinal);foreach(var item in value.EnumerateObject()){Unicode(item.Name);Require((journal&&depth==1||!Reserved.Contains(item.Name))&&keys.Add(item.Name));Validate(item.Value,ref budget,journal,depth+1);}}
        else if(value.ValueKind==JsonValueKind.Array){foreach(var item in value.EnumerateArray())Validate(item,ref budget,journal,depth+1);}
        else if(value.ValueKind==JsonValueKind.String)Unicode(value.GetString()!);
        else if(value.ValueKind==JsonValueKind.Number)_=Number(value.GetRawText());
    }
    static string Canonical(JsonElement value)=>value.ValueKind switch
    {
        JsonValueKind.Object=>"{"+string.Join(",",value.EnumerateObject().OrderBy(item=>item.Name,StringComparer.Ordinal).Select(item=>JsonSerializer.Serialize(item.Name)+":"+Canonical(item.Value)))+"}",
        JsonValueKind.Array=>"["+string.Join(",",value.EnumerateArray().Select(Canonical))+"]",
        JsonValueKind.Number=>Number(value.GetRawText()),
        JsonValueKind.String=>JsonSerializer.Serialize(value.GetString()),
        _=>value.GetRawText()
    };
    static async Task<byte[]> Read(Stream input,int limit,CancellationToken cancellation)
    {
        using var output=new MemoryStream();byte[] buffer=new byte[8192];int count;
        while((count=await input.ReadAsync(buffer,cancellation))>0){if(output.Length+count>limit)throw new Status(413);output.Write(buffer,0,count);}return output.ToArray();
    }

    sealed class Client : IDisposable
    {
        readonly HttpClient http;readonly string endpoint,credential,delegation,plugin,version;string? session;
        public Client()
        {
            endpoint=Env("PLUGIN_CONTROL_URL","").TrimEnd('/');var uri=new Uri(endpoint);Require(uri.IsAbsoluteUri&&uri.UserInfo==""&&uri.Query==""&&uri.Fragment==""&&(uri.AbsolutePath==""||uri.AbsolutePath=="/"));Require(uri.Scheme=="https"||uri.Scheme=="http"&&new[]{"localhost","127.0.0.1","[::1]","::1"}.Contains(uri.Host));credential=Credential("PLUGIN_TOKEN");delegation=Env("PLUGIN_DELEGATION","");Require(Regex.IsMatch(delegation,Token)&&!delegation.Contains('\n'));plugin=Env("PLUGIN_ID","example.reader");version=Env("PLUGIN_VERSION","1.0.0");http=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false}){Timeout=Timeout.InfiniteTimeSpan};
        }
        async Task<JsonElement> Post(string path,object value,bool delegated=false)
        {
            byte[] body=JsonSerializer.SerializeToUtf8Bytes(value);Require(body.Length<=65536);using var request=new HttpRequestMessage(HttpMethod.Post,endpoint+path){Content=new ByteArrayContent(body)};request.Content.Headers.ContentType=new("application/json");request.Headers.TryAddWithoutValidation("Authorization","Bearer "+credential);if(delegated)request.Headers.TryAddWithoutValidation("X-DC-Delegation",delegation);
            using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(10));using var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,deadline.Token);Require(response.Content.Headers.ContentType?.MediaType=="application/json");await using var stream=await response.Content.ReadAsStreamAsync(deadline.Token);var result=Parse(await Read(stream,1048576,deadline.Token));Require(Text(Get(result,"protocol"))==Control);Require(response.StatusCode==HttpStatusCode.OK);return result;
        }
        public async Task<JsonElement> Run(JsonElement command)
        {
            Fields(command,"command input");var operation=Text(Get(command,"command"));Require(Commands.Contains(operation));Object(Get(command,"input"));var ready=await Post("/plugins/handshake",Map("protocol",Control,"pluginId",plugin,"version",version));Fields(ready,"protocol pluginId version sessionId expiresAt generation commands quotas");Require(Text(Get(ready,"pluginId"))==plugin&&Text(Get(ready,"version"))==version&&Match(Get(ready,"sessionId"),Token));session=Text(Get(ready,"sessionId"));_=Integer(Get(ready,"generation"));_=DateTimeOffset.Parse(Text(Get(ready,"expiresAt")),CultureInfo.InvariantCulture);var grants=Array(Get(ready,"commands")).Select(Text).ToArray();Require(grants.Distinct().Count()==grants.Length&&grants.All(Commands.Contains)&&grants.Contains(operation));var quotas=Get(ready,"quotas");Fields(quotas,"maxRequestBytes maxResponseBytes concurrency timeoutMs");_=Integer(Get(quotas,"maxRequestBytes"),1,1048576);_=Integer(Get(quotas,"maxResponseBytes"),1,33554432);_=Integer(Get(quotas,"concurrency"),1,32);_=Integer(Get(quotas,"timeoutMs"),1,300000);
            var requestId=Guid.NewGuid().ToString();var reply=await Post("/plugins/commands",Map("protocol",Control,"sessionId",session,"requestId",requestId,"command",operation,"input",Get(command,"input")),true);Fields(reply,"protocol requestId command result");Require(Text(Get(reply,"requestId"))==requestId&&Text(Get(reply,"command"))==operation);var result=Get(reply,"result");Object(result);return result;
        }
        public async Task Close(){if(session!=null){var reply=await Post("/plugins/sessions/close",Map("protocol",Control,"sessionId",session));Fields(reply,"protocol sessionId status");Require(Text(Get(reply,"sessionId"))==session&&Text(Get(reply,"status"))=="closed");}}
        public void Dispose()=>http.Dispose();
    }

    sealed class Service : IDisposable
    {
        readonly string credential=Credential("PLUGIN_TOKEN"),provider=Env("TRANSFER_POLICY_PROVIDER_ID","example.transfer"),journal;
        readonly Dictionary<string,JsonElement> actors=new(StringComparer.Ordinal),receipts=new(StringComparer.Ordinal);
        readonly FileStream exclusive;readonly int capacity;readonly object gate=new();bool poisoned;
        public Service(string records,string path)
        {
            journal=Path.GetFullPath(path);Require(int.TryParse(Env("PLUGIN_MAX_RECEIPTS","1000"),out capacity)&&capacity>=1&&capacity<=10000);Require(Regex.IsMatch(provider,Id)&&!provider.Contains('\n')&&!Reserved.Contains(provider));Require(new FileInfo(records).Length<=65536);var config=Parse(File.ReadAllBytes(records));Fields(config,"actors");var rows=Array(Get(config,"actors"));Require(rows.Length<=100);
            foreach(var actor in rows){Fields(actor,"id recipientIds allowListingReservation");Require(Identifier(Get(actor,"id"))&&Get(actor,"allowListingReservation").ValueKind is JsonValueKind.True or JsonValueKind.False);var recipients=Array(Get(actor,"recipientIds"));Require(recipients.Length<=100&&recipients.All(Identifier)&&recipients.Select(Text).Distinct().Count()==recipients.Length);Require(actors.TryAdd(Text(Get(actor,"id")),actor));}
            exclusive=new FileStream(journal+".lock",FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
            if(File.Exists(journal)){Require(new FileInfo(journal).Length<=4194304);var saved=Parse(File.ReadAllBytes(journal),20,1000000,true);Fields(saved,"version receipts");_=Integer(Get(saved,"version"),1,1);var retained=Get(saved,"receipts");Object(retained);Require(retained.EnumerateObject().Count()<=10000);foreach(var row in retained.EnumerateObject()){Fields(row.Value,"digest payload");var payload=Get(row.Value,"payload");ValidateAction(payload);Require(Text(Get(payload,"jobId"))==row.Name&&Text(Get(row.Value,"digest"))==Hash(Canonical(payload)));receipts.Add(row.Name,row.Value);}}
        }
        void Persist(byte[] bytes)
        {
            var temporary=Path.Combine(Path.GetDirectoryName(journal)!,"csharp-receipts-"+Guid.NewGuid()+".tmp");
            try{using(var file=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,8192,FileOptions.WriteThrough)){file.Write(bytes);file.Flush(true);}if(File.Exists(journal))File.Replace(temporary,journal,null);else File.Move(temporary,journal);}finally{if(File.Exists(temporary))File.Delete(temporary);}
        }
        void ValidateAction(JsonElement value)
        {
            Fields(value,"protocol pluginId handlerId jobId beneficiaryId source params");Require(Text(Get(value,"protocol"))==Action&&Text(Get(value,"pluginId"))=="example.receiver"&&Text(Get(value,"handlerId"))=="example.record");var job=Text(Get(value,"jobId"));Require(job.Length>=1&&job.Length<=128);Require(Get(value,"beneficiaryId").ValueKind is JsonValueKind.Null or JsonValueKind.String);Object(Get(value,"source"));Object(Get(value,"params"));
        }
        object Record(JsonElement value,string key)
        {
            lock(gate){if(poisoned)throw new Status(503);ValidateAction(value);Require(Text(Get(value,"jobId"))==key);var digest=Hash(Canonical(value));if(receipts.TryGetValue(key,out var known)){if(Text(Get(known,"digest"))!=digest)throw new Status(409);}else{if(receipts.Count>=capacity)throw new Status(507);receipts.Add(key,JsonSerializer.SerializeToElement(Map("digest",digest,"payload",value)));byte[] bytes;try{bytes=JsonSerializer.SerializeToUtf8Bytes(Map("version",1,"receipts",receipts));if(bytes.Length>4194304)throw new Status(507);try{_=Parse(bytes,20,1000000,true);}catch(Exception rejected) when(rejected is Contract or JsonException or DecoderFallbackException or InvalidOperationException or FormatException){throw new Status(507);}}catch{receipts.Remove(key);throw;}try{Persist(bytes);}catch{poisoned=true;throw;}}return Map("protocol",Action,"pluginId","example.receiver","jobId",key,"status","completed");}
        }
        object Transfer(JsonElement value)
        {
            Fields(value,"protocol operation scope phase requestId providerId grantId generation commandId inputDigest snapshotDigest deadline context");Require(Text(Get(value,"protocol"))=="digital-card-transfer-policy@1"&&Text(Get(value,"operation"))=="canTransfer"&&Text(Get(value,"scope"))=="transfer"&&Text(Get(value,"providerId"))==provider&&Match(Get(value,"requestId"),Uuid)&&Match(Get(value,"grantId"),Uuid));_=Integer(Get(value,"generation"));_=Integer(Get(value,"deadline"));foreach(var field in new[]{"commandId","inputDigest","snapshotDigest"})Require(Match(Get(value,field),"^[a-f0-9]{64}$"));Require(OneOf(Get(value,"phase"),"review","propose","counter","accept","list","quote","purchase"));var context=Get(value,"context");Fields(context,"channel legs");Require(OneOf(Get(context,"channel"),"trade","sale"));var legs=Array(Get(context,"legs"));Require(legs.Length>=1&&legs.Length<=2);var seen=new HashSet<string>();bool allowed=true;
            foreach(var leg in legs){Fields(leg,"fromUserId toUserId copyIds versions");Require(Identifier(Get(leg,"fromUserId"))&&(Get(leg,"toUserId").ValueKind==JsonValueKind.Null||Identifier(Get(leg,"toUserId"))));var copies=Array(Get(leg,"copyIds"));var versions=Array(Get(leg,"versions"));Require(copies.Length>=1&&copies.Length==versions.Length);for(int n=0;n<copies.Length;n++){Require(Match(copies[n],Uuid)&&seen.Add(Text(copies[n])));_=Integer(versions[n]);}bool configured=actors.TryGetValue(Text(Get(leg,"fromUserId")),out var actor);allowed&=configured&&(Get(leg,"toUserId").ValueKind==JsonValueKind.Null?Get(actor,"allowListingReservation").ValueKind==JsonValueKind.True:Array(Get(actor,"recipientIds")).Select(Text).Contains(Text(Get(leg,"toUserId"))));}Require(seen.Count<=2000);
            var result=value.EnumerateObject().Where(item=>item.Name!="context").ToDictionary(item=>item.Name,item=>(object?)item.Value,StringComparer.Ordinal);result.Add("status",allowed?"allowed":"denied");if(!allowed)result.Add("reasonCode","restricted");return result;
        }
        public async Task Handle(HttpContext context)
        {
            int status=200;object result;
            try{Require(context.Request.Method=="POST"&&!context.Request.QueryString.HasValue);var path=context.Request.Path.Value;if(path!="/actions"&&path!="/transfer-policy")throw new Status(404);var auth=context.Request.Headers.Authorization;if(auth.Count!=1||!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(auth[0]??""),Encoding.UTF8.GetBytes("Bearer "+credential)))throw new Status(403);Require(context.Request.ContentType?.Split(';')[0]=="application/json"&&!context.Request.Headers.ContainsKey("Content-Encoding"));using var deadline=CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);deadline.CancelAfter(TimeSpan.FromSeconds(10));var value=Parse(await Read(context.Request.Body,65536,deadline.Token));Object(value);if(path=="/actions"){var keys=context.Request.Headers["Idempotency-Key"];Require(keys.Count==1);result=Record(value,keys[0]??"");}else result=Transfer(value);}
            catch(Status error){status=error.Code;result=Map();}
            catch(Exception error) when(error is Contract or JsonException or DecoderFallbackException or InvalidOperationException or FormatException){status=400;result=Map();}
            catch(Microsoft.AspNetCore.Http.BadHttpRequestException error){status=error.StatusCode;result=Map();}
            catch{status=503;result=Map();}
            context.Response.StatusCode=status;context.Response.ContentType="application/json";context.Response.Headers.CacheControl="no-store";byte[] bytes=JsonSerializer.SerializeToUtf8Bytes(result);context.Response.ContentLength=bytes.Length;await context.Response.Body.WriteAsync(bytes,context.RequestAborted);
        }
        public void Dispose()=>exclusive.Dispose();
    }
    public static async Task<int> Main(string[] args)
    {
        try{Require(args.Length>=1);if(args[0]=="client"){Require(args.Length==1);using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(10));var command=Parse(await Read(Console.OpenStandardInput(),65536,deadline.Token));using var client=new Client();JsonElement result;try{result=await client.Run(command);}finally{await client.Close();}Console.WriteLine(result.GetRawText());}
            else{Require(args.Length==3&&args[0]=="serve");using var service=new Service(args[1],args[2]);var builder=WebApplication.CreateSlimBuilder();builder.Logging.ClearProviders();builder.WebHost.ConfigureKestrel(options=>{options.Listen(IPAddress.Loopback,0,listen=>listen.Protocols=HttpProtocols.Http1);options.Limits.MaxRequestBodySize=65536;options.Limits.MaxConcurrentConnections=8;options.Limits.MaxRequestHeaderCount=16;options.Limits.MaxRequestHeadersTotalSize=8192;options.Limits.RequestHeadersTimeout=TimeSpan.FromSeconds(10);options.Limits.KeepAliveTimeout=TimeSpan.FromSeconds(10);});await using var app=builder.Build();app.Run(service.Handle);await app.StartAsync();var url=app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();Console.WriteLine(new Uri(url).Port);await app.WaitForShutdownAsync();}return 0;}
        catch{Console.Error.WriteLine("CONFORMANCE_FAILED");return 1;}
    }
}
