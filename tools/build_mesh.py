
import math, json, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OBJ = os.path.join(ROOT, "assets", "AIM120D.obj")
OUT_JS = os.path.join(ROOT, "js", "missile.mesh.js")
OUT_META = os.path.join(ROOT, "assets", "mesh-meta.json")

verts=[]; faces=[]
for line in open(OBJ, encoding="utf-8", errors="replace"):
    s=line.strip()
    if s.startswith("v "):
        a=s.split(); verts.append((float(a[1]), float(a[2]), float(a[3])))
    elif s.startswith("f "):
        faces.append(tuple(int(t.split("/")[0])-1 for t in s.split()[1:]))

cx, cy = 2.354, 5.212
zs=[v[2] for v in verts]; z_nose=min(zs); z_tail=max(zs); L=z_tail-z_nose
SCALE = 3.66 / L
def to3(v):
    return ((0.5*L-(v[2]-z_nose))*SCALE, (v[1]-cy)*SCALE, (v[0]-cx)*SCALE)
P=[to3(v) for v in verts]

tris=[]
for f in faces:
    for k in range(1,len(f)-1): tris.append([f[0],f[k],f[k+1]])

def sub(a,b): return (a[0]-b[0],a[1]-b[1],a[2]-b[2])
def cross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def norm(a):
    l=math.sqrt(sum(x*x for x in a)); return (0.0,0.0,0.0) if l<1e-12 else tuple(x/l for x in a)
def dot(a,b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]

def fnormal(t):
    a,b,c=P[t[0]],P[t[1]],P[t[2]]
    return norm(cross(sub(b,a),sub(c,a)))
def farea(t):
    a,b,c=P[t[0]],P[t[1]],P[t[2]]
    n=cross(sub(b,a),sub(c,a)); return 0.5*math.sqrt(dot(n,n))

# --- edge adjacency with direction
edge_map=collections.defaultdict(list)   # (u,v) sorted -> [(tri, same_dir)]
for ti,t in enumerate(tris):
    for k in range(3):
        u=t[k]; v=t[(k+1)%3]
        edge_map[(min(u,v),max(u,v))].append((ti, u<v))
# flood fill orientation
flip=[False]*len(tris)
visited=[False]*len(tris)
queue=[0]; visited[0]=True
while queue:
    ti=queue.pop()
    t=tris[ti]
    for k in range(3):
        u=t[k]; v=t[(k+1)%3]
        key=(min(u,v),max(u,v))
        for (tj, same_dir) in edge_map[key]:
            if tj==ti or visited[tj]: continue
            # ti traverses u->v. determine if tj traverses same direction
            t2=tris[tj]
            # find direction of edge in tj
            tj_same = None
            for kk in range(3):
                a=t2[kk]; b=t2[(kk+1)%3]
                if a==u and b==v: tj_same=True
                if a==v and b==u: tj_same=False
            if tj_same is None: continue
            # consistent orientation => opposite directions
            need_flip = (tj_same == True)
            flip[tj] = flip[ti] ^ need_flip
            visited[tj]=True
            queue.append(tj)
print("flipped:", sum(flip), "of", len(tris), "visited", sum(visited))
for i in range(len(tris)):
    if flip[i]: tris[i]=[tris[i][0],tris[i][2],tris[i][1]]

# recompute normals
fn=[fnormal(t) for t in tris]
area=[farea(t) for t in tris]
vol=sum(dot(P[t[0]], cross(P[t[1]],P[t[2]]))/6.0 for t in tris)
print("volume:", round(vol,6))
if vol<0:
    tris=[[t[0],t[2],t[1]] for t in tris]; fn=[(-x,-y,-z) for (x,y,z) in fn]; vol=-vol

# edge dot histogram after fix
hist=collections.Counter(); bad=0
for key, lst in edge_map.items():
    if len(lst)==2:
        d=dot(fn[lst[0][0]],fn[lst[1][0]])
        hist[round(min(d,1.0),1)]+=1
        if d<0: bad+=1
print("neg dots after fix:", bad)
print("hist:", dict(sorted(hist.items(), key=lambda kv:str(kv[0]))))

# smoothing groups
COS_T=math.cos(math.radians(40))
inc=collections.defaultdict(list)
for ti,t in enumerate(tris):
    for v in t: inc[v].append(ti)
out_pos=[]; out_nrm=[]; corner={}
group_sizes=collections.Counter()
for v, ts in inc.items():
    par=list(range(len(ts)))
    def find(i):
        while par[i]!=i: par[i]=par[par[i]]; i=par[i]
        return i
    def uni(i,j):
        ri,rj=find(i),find(j)
        if ri!=rj: par[ri]=rj
    for i in range(len(ts)):
        for j in range(i+1,len(ts)):
            if dot(fn[ts[i]],fn[ts[j]])>=COS_T: uni(i,j)
    groups=collections.defaultdict(list)
    for i,ti in enumerate(ts): groups[find(i)].append(ti)
    group_sizes[len(groups)]+=1
    for g,tlist in groups.items():
        acc=[0.0,0.0,0.0]
        for ti in tlist:
            w=area[ti]
            for k in range(3): acc[k]+=fn[ti][k]*w
        n=norm(tuple(acc))
        vi=len(out_pos)//3
        out_pos.extend([round(P[v][0],5),round(P[v][1],5),round(P[v][2],5)])
        out_nrm.extend([round(n[0],4),round(n[1],4),round(n[2],4)])
        for ti in tlist: corner[(ti,v)]=vi
print("group count per vertex hist:", dict(group_sizes))
print("render verts:", len(out_pos)//3)
idx=[]
for ti,t in enumerate(tris):
    idx.extend([corner[(ti,t[0])],corner[(ti,t[1])],corner[(ti,t[2])]])

xs=out_pos[0::3]; ys=out_pos[1::3]; zs2=out_pos[2::3]
meta={
 "source":"AIM120D.blend (Blender 2.70, aigei.com free model)",
 "converted":"AIM120D.obj",
 "sourceVertices":len(verts),"sourceFaces":len(faces),"triangles":len(tris),
 "renderVertices":len(out_pos)//3,
 "lengthM":3.66,"bodyDiameterM":round(4.892*SCALE,4),"finSpanM":round(11.52*SCALE,4),
 "massKg":152,"cgFromNose":0.5,
 "scaleMperUnit":round(SCALE,6),
 "bboxM":{"x":round(max(xs)-min(xs),3),"y":round(max(ys)-min(ys),3),"z":round(max(zs2)-min(zs2),3)}
}
print(json.dumps(meta,indent=1))

def fmt(arr, per=12):
    out=[]
    for i in range(0,len(arr),per):
        out.append(",".join(("%.5f"%x).rstrip("0").rstrip(".") if isinstance(x,float) else str(x) for x in arr[i:i+per]))
    return ",\n".join(out)
body="// Auto-generated from assets/AIM120D.obj (source: AIM120D.blend, Blender 2.70).\n"
body+="// Body frame: +X nose, +Y up, +Z right. CG at origin. Units: metres.\n"
body+="window.AIM120D_MESH = {\n  meta: "+json.dumps(meta,ensure_ascii=False)+",\n"
body+="  positions: ["+fmt(out_pos)+"],\n  normals: ["+fmt(out_nrm)+"],\n  indices: ["+",".join(str(i) for i in idx)+"]\n};\n"
open(OUT_JS,"w",encoding="utf-8").write(body)
open(OUT_META,"w",encoding="utf-8").write(json.dumps(meta,indent=1,ensure_ascii=False))
print("wrote",os.path.getsize(OUT_JS),"bytes")
