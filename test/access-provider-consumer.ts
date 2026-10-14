import {createRemoteAccessProvider,createHostAccessResolver} from '@digital-card/framework/remote-access-provider';
import {validateAccessProviderResponse} from '@digital-card/framework/access-provider-contracts';

const provider=createRemoteAccessProvider({providerId:'example.access',url:'https://access.example.test/access-provider',token:'configured-service-credential',allowRoles:['player'],allowPermissions:['art.import']});
const identity={issuer:'https://issuer.example',subject:'collector',userId:'collector'};
void provider.resolveAccess(identity,{signal:new AbortController().signal}).then(access=>console.log(access?.permissions));
provider.setEnabled(false);
provider.close();
const host=createHostAccessResolver({resolveAccess:async()=>({role:'player',permissions:['art.import']})});
void host.resolveAccess?.(identity);
host.close();
const response=validateAccessProviderResponse(JSON.parse('{}'));
if(response.status==='allowed')console.log(response.role,response.permissions);
// @ts-expect-error Only declared framework roles are valid grants.
createRemoteAccessProvider({providerId:'example.access',url:'https://access.example.test/access-provider',token:'configured-service-credential',allowRoles:['owner'],allowPermissions:[]});
// @ts-expect-error Permission grants cannot contain unknown capabilities.
createRemoteAccessProvider({providerId:'example.access',url:'https://access.example.test/access-provider',token:'configured-service-credential',allowRoles:['player'],allowPermissions:['everything']});
