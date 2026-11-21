import numpy as np, json, sys
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
import os
U=os.environ.get('SHEETS_DIR', './sheets/')  # folder with the original pink-background sheets
SHEETS={k: f'{k}.png' for k in 'abcde'}   # a: houses+furniture, b: roofs/walls, c: furniture, d: roads/terrain, e: shops/props
def load(k):
    im=Image.open(U+SHEETS[k]).convert('RGB'); return np.array(im).astype(np.int16)
def bgmask(a):
    R,G,B=a[...,0],a[...,1],a[...,2]
    m=(R>=240)&(B>=200)&(G>=95)&(G<=165)&((B-G)>=55)
    return m
def cutout(k):
    a=load(k); m=bgmask(a)
    lab,n=ndi.label(m)
    border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
    sizes=ndi.sum(m,lab,range(1,n+1))
    bg=np.zeros_like(m)
    for i in range(1,n+1):
        if i in border or sizes[i-1]>=150: bg|=(lab==i)
    R,G,B=a[...,0],a[...,1],a[...,2]
    # pink drop-shadows / glows: darker magenta-pinks connected to the background
    loose=(R>=140)&(R<=246)&(G<=R-60)&(B>=G+35)&(B>=120)
    bg=ndi.binary_propagation(bg,mask=bg|loose)
    # light anti-aliased fringe right at the edge
    pinkish=(R>=232)&((B-G)>=38)&(B>=190)&(G<=190)
    ring=ndi.binary_dilation(bg,iterations=2)&pinkish&~bg
    bg|=ring
    alpha=(~bg).astype(np.uint8)*255
    # remove isolated specks
    lab2,n2=ndi.label(alpha>0)
    sz=ndi.sum(alpha>0,lab2,range(1,n2+1))
    keep=np.isin(lab2,[i+1 for i,s in enumerate(sz) if s>=30])
    alpha=np.where(keep,alpha,0).astype(np.uint8)
    rgba=np.dstack([a.astype(np.uint8),alpha])
    return rgba
if __name__=='__main__':
    for k in SHEETS:
        rgba=cutout(k); Image.fromarray(rgba,'RGBA').save(f'cut_{k}.png')
        print(k,'alpha coverage',(rgba[...,3]>0).mean().round(3))
