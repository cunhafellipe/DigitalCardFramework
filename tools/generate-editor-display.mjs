import {readFileSync,writeFileSync} from 'node:fs';
import {editorDisplaySchema,editorProposalSchema} from '../src/presentation/editor-display.js';
for(const [name,schema] of [['editor-display.schema.json',editorDisplaySchema],['editor-proposal.schema.json',editorProposalSchema]]){
  const path=new URL('../docs/'+name,import.meta.url),content=JSON.stringify(schema,null,2)+'\n';
  if(process.argv.includes('--check')){
    if(readFileSync(path,'utf8')!==content)throw new Error('Editor contract drift: '+name);
  }else writeFileSync(path,content);
}
