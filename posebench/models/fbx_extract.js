const fs=require('fs');
module.exports=async p=>{
  const out={};
  for(const k of ['male','female']){
    const f='C:/ai/ComfyUI_WP/ComfyUI/output/pb_body_'+k+'_rig_mia.fbx';
    if(!fs.existsSync(f)){out[k]='missing '+f;continue;}
    try{const d=await p.evaluate(u=>window.extract(u),'file:///'+f);
      fs.writeFileSync('D:/claudecode/storyboarder/posebench/models/mia_'+k+'.json',JSON.stringify(d));
      out[k]={bones:d.bones.length,verts:d.pos.length/3,tris:d.idx.length/3,meshes:d.meshes,names:d.bones.map(b=>b.name).join(' ')};}
    catch(e){out[k]='ERR '+e;}
  }
  return out;
};
