import json, urllib.request, time, sys
ids={}
for k in ['male','female']:
    prompt={
     "1":{"class_type":"GeomPackLoadMeshPath","inputs":{"file_path":"C:/ai/ComfyUI_WP/ComfyUI/input/3d/pb_body_%s.glb"%k}},
     "2":{"class_type":"MIALoadModel","inputs":{"precision":"fp32","attn_backend":"auto"}},
     "3":{"class_type":"MIAAutoRig","inputs":{"trimesh":["1",0],"model":["2",0],"fbx_name":"pb_body_%s_rig"%k,"no_fingers":False,"use_normal":False,"reset_to_rest":True}},
     "4":{"class_type":"UniRigPreviewRiggedMesh","inputs":{"fbx_output_path":["3",0]}}}
    req=urllib.request.Request('http://127.0.0.1:8188/prompt',data=json.dumps({"prompt":prompt,"client_id":"storyboarder-prep"}).encode(),headers={'Content-Type':'application/json'})
    r=json.loads(urllib.request.urlopen(req,timeout=20).read().decode()); ids[k]=r['prompt_id']; print(k,'queued',flush=True)
t0=time.time(); done={}
while time.time()-t0<1200 and len(done)<len(ids):
    for k,i in ids.items():
        if k in done: continue
        h=json.loads(urllib.request.urlopen('http://127.0.0.1:8188/history/'+i,timeout=10).read().decode())
        if i in h: done[k]=h[i]
    time.sleep(5)
for k,h in done.items():
    st=h.get('status',{}); err=[m[1].get('exception_message','')[:1500] for m in st.get('messages',[]) if m[0]=='execution_error']
    print(k, st.get('status_str'), err[:1]); print('  outputs', json.dumps(h.get('outputs',{}))[:600])
