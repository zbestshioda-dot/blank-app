import numpy as np, json
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
def xycut(m,x0,y0,x1,y1,gap=3):
    sub=m[y0:y1,x0:x1]
    ys,xs=np.where(sub)
    if len(ys)==0: return []
    x0,x1,y0,y1=x0+xs.min(),x0+xs.max()+1,y0+ys.min(),y0+ys.max()+1
    sub=m[y0:y1,x0:x1]
    for axis in (0,1):
        prof=sub.any(axis=axis)   # axis0 -> columns, axis1 -> rows
        runs=[];start=None
        for i,v in enumerate(prof):
            if v and start is None: start=i
            if not v and start is not None: runs.append((start,i)); start=None
        if start is not None: runs.append((start,len(prof)))
        # merge runs separated by tiny gaps
        merged=[]
        for r in runs:
            if merged and r[0]-merged[-1][1]<gap: merged[-1]=(merged[-1][0],r[1])
            else: merged.append(r)
        if len(merged)>1:
            out=[]
            for a_,b_ in merged:
                if axis==0: out+=xycut(m,x0+a_,y0,x0+b_,y1,gap)
                else: out+=xycut(m,x0,y0+a_,x1,y0+b_,gap)
            return out
    if (sub.sum())<40: return []
    return [[int(x0),int(y0),int(x1-x0),int(y1-y0)]]
def segment(k, merge=1, minside=14):
    im=Image.open(f'cut_{k}.png'); a=np.array(im)
    m=a[...,3]>0
    d=ndi.binary_dilation(m,structure=np.ones((3,3)),iterations=merge)
    lab,n=ndi.label(d)
    boxes=[]
    for i,sl in enumerate(ndi.find_objects(lab),1):
        y0,y1,x0,x1=sl[0].start,sl[0].stop,sl[1].start,sl[1].stop
        sub=m[y0:y1,x0:x1]&(lab[y0:y1,x0:x1]==i)
        ys,xs=np.where(sub)
        if len(ys)<40: continue
        bx0,bx1,by0,by1=x0+xs.min(),x0+xs.max()+1,y0+ys.min(),y0+ys.max()+1
        if bx1-bx0<minside or by1-by0<minside: continue
        for bb in xycut(m, int(bx0),int(by0),int(bx1),int(by1)):
            if bb[2]>=minside and bb[3]>=minside: boxes.append(bb)
    boxes.sort(key=lambda b:(round((b[1]+b[3]/2)/60),b[0]))   # rough reading order
    return boxes
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',13) if __import__('os').path.exists('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') else ImageFont.load_default()
if __name__=='__main__':
    allb={}
    for k in 'abcde':
        bx=segment(k); allb[k]=bx
        print(k,len(bx))
        base=Image.open(f'prev_{k}.png').convert('RGB'); dr=ImageDraw.Draw(base)
        for i,(x,y,w,h) in enumerate(bx):
            dr.rectangle([x,y,x+w,y+h],outline=(255,255,0),width=1)
            t=str(i); tw=dr.textlength(t,font=font)
            dr.rectangle([x,y,x+tw+4,y+15],fill=(0,0,0)); dr.text((x+2,y),t,fill=(255,255,0),font=font)
        base.save(f'num_{k}.png')
        base.crop((0,0,836,941)).save(f'num_{k}_L.png'); base.crop((836,0,1672,941)).save(f'num_{k}_R.png')
    json.dump(allb,open('boxes.json','w'))
