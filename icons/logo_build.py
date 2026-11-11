"""ಜಲಗಾರ logo: laterite sky, hazy Ghats ridge, a red-earth lane between uneven groves, a slender broom leaning mid-sweep, and ಜ cut into a low sun half-hidden by the far ridge.
Re-render the PNG icons from logo.svg / logo-maskable.svg after changing anything here."""
# builds the ಜಲಗಾರ logo from parameters
import math, json
import os
HERE=os.path.dirname(os.path.abspath(__file__))
GLYPHS=json.load(open(os.path.join(HERE,'ja_glyphs.json')))   # outline of ಜ from Noto Serif/Sans Kannada and Baloo Tamma 2 (SIL Open Font License)
G_back,G_mid,G_front='#5f8a3e','#77a352','#93bf68'
def canopy(cx,cy,r,col):
    parts=[(0,0,1),(-0.62,0.22,0.72),(0.62,0.2,0.74),(-0.3,-0.42,0.66),(0.32,-0.38,0.64)]
    return ''.join(f'<circle cx="{cx+dx*r:.1f}" cy="{cy+dy*r:.1f}" r="{s*r:.1f}" fill="{col}"/>' for dx,dy,s in parts)
def broom(top=80, tie1=148, tie2=162, foot=404, half=70, n=13, sw=4.2, lean=-7, bias=10):
    sticks=[]
    for i in range(n):
        f=(i-(n-1)/2)/((n-1)/2)
        xt=256+f*7; xtie=256+f*11
        xe=256+f*half+bias*(1+f)/2            # bristles flare a little more to one side, as in a sweep
        ye=foot-abs(f)**2*22 - (8 if f<0 else 0)*abs(f)
        cx=256+f*26+bias*0.4; cy=tie2+(foot-tie2)*0.45
        sticks.append(f'<path d="M{xt:.1f} {top+abs(f)*5:.1f} L{xtie:.1f} {tie2:.1f} Q{cx:.1f} {cy:.1f} {xe:.1f} {ye:.1f}"/>')
    return (f'<g transform="rotate({lean} 256 {foot})">'
            f'<g fill="none" stroke="#fbf6ea" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" opacity=".93">{"".join(sticks)}</g>'
            f'<rect x="238" y="{tie1}" width="36" height="7" rx="3.5" fill="#f6d58a" opacity=".95"/>'
            f'<rect x="240" y="{tie1+11}" width="32" height="6" rx="3" fill="#f6d58a" opacity=".95"/></g>')
def lane(P=((170,524),(236,430),(392,392),(334,296)), w0=168, w1=5, steps=48):
    def bez(t):
        u=1-t; return tuple(u**3*P[0][i]+3*u*u*t*P[1][i]+3*u*t*t*P[2][i]+t**3*P[3][i] for i in (0,1))
    L,R=[],[]
    for k in range(steps+1):
        t=k/steps; x,y=bez(t); x2,y2=bez(min(1,t+0.01)); x1,y1=bez(max(0,t-0.01))
        dx,dy=x2-x1,y2-y1; n=(dx*dx+dy*dy)**.5 or 1; nx,ny=-dy/n,dx/n
        w=(w0*(1-t)**1.35+w1)/2
        L.append((x+nx*w,y+ny*w)); R.append((x-nx*w,y-ny*w))
    pts=L+R[::-1]
    return '<path d="M'+' L'.join(f'{x:.1f} {y:.1f}' for x,y in pts)+' Z" fill="#e8b48e" opacity=".45"/>'
def ridge(pts, base, col, op):
    # smooth ridge through the given (x,y) peaks/saddles, closed down to the base line
    d=f'M-10 {pts[0][1]:.1f} '
    for (x0,y0),(x1,y1) in zip(pts,pts[1:]):
        c0=x0+(x1-x0)*0.38; c1=x1-(x1-x0)*0.38
        d+=f'C{c0:.1f} {y0+(y1-y0)*0.12:.1f} {c1:.1f} {y1-(y1-y0)*0.12:.1f} {x1:.1f} {y1:.1f} '
    d+=f'L522 {base} L-10 {base} Z'
    return f'<path d="{d}" fill="{col}" opacity="{op}"/>'
def scene(sun=(398,222,44), font='serif'):
    s=''
    # the sun with ಜ, sitting low so the far ridge hides part of it
    s+=plate(*sun, font=font)
    # horizon: a hazy far range with a tall peak to the left, and the nearer hills that become the ground
    s+=ridge([(-10,262),(40,236),(92,196),(132,222),(176,212),(232,250),(300,236),(360,256),(430,228),(480,246),(522,240)],512,'#c97f5e',1)
    s+=ridge([(-10,290),(70,270),(150,288),(230,274),(300,296),(380,284),(450,298),(522,288)],512,'#8e3e1f',1)
    # road: a lane that starts wide at the front and winds away to the right, tapering into the distance
    s+=lane()
    # trees: a fuller grove on the left, a lighter pair on the right
    for cx,cy,r,col in [(40,318,52,G_back),(118,300,34,G_back),(176,312,22,G_back),(14,420,62,G_mid),(84,452,44,G_front),(150,488,30,G_mid),
                        (392,286,20,G_back),(452,318,34,G_back),(494,420,44,G_mid)]:
        s+=canopy(cx,cy,r,col)
    return s
def plate(cx,cy,r,font='serif'):
    """ಜ in a plain disc that doubles as a sun over the hills: flat, no shadow or rim;
    the letter is cut out in the colour of the sky behind it."""
    g=GLYPHS[font]; x0,y0,x1,y1=g['bounds']; w,h=x1-x0,y1-y0
    sc=(r*1.0)/max(w,h); tx=cx-(x0+w/2)*sc; ty=cy+(y0+h/2)*sc-r*0.2
    return (f'<circle cx="{cx}" cy="{cy}" r="{r*2.6:.1f}" fill="url(#glow)"/><circle cx="{cx}" cy="{cy}" r="{r}" fill="#fbe2ad" opacity=".82"/>'
            f'<path d="{g["d"]}" transform="translate({tx:.2f} {ty:.2f}) scale({sc:.5f} {-sc:.5f})" fill="#a9502e" opacity=".78"/>')
def svg(rounded=True, font='serif'):
    clip='<rect width="512" height="512" rx="112"/>' if rounded else '<rect width="512" height="512"/>'
    bg=f'<rect width="512" height="512" {"rx=\"112\" " if rounded else ""}fill="url(#bg)"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="ಜಲಗಾರ">
  <defs>
    <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="60" y2="300"><stop offset="0" stop-color="#7d4a4a"/><stop offset=".45" stop-color="#b8644a"/><stop offset=".8" stop-color="#e3925f"/><stop offset="1" stop-color="#f2b27c"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#ffe2a8" stop-opacity=".55"/><stop offset="1" stop-color="#ffe2a8" stop-opacity="0"/></radialGradient>
    <clipPath id="ic">{clip}</clipPath>
  </defs>
  {bg}
  <!-- a red-earth village road bending between uneven groves of trees -->
  <g clip-path="url(#ic)">{scene((398,222,44) if rounded else (380,226,40), font)}</g>
  <!-- the broom (ಪೊರಕೆ), leaning mid-sweep -->
  {broom()}
</svg>'''
import sys
FONT=sys.argv[1] if len(sys.argv)>1 else 'serif'
# usage: python3 logo_build.py [serif|sans|baloo]  → writes logo.svg and logo-maskable.svg next to this script
open(os.path.join(HERE,'logo.svg'),'w').write(svg(True,FONT))
open(os.path.join(HERE,'logo-maskable.svg'),'w').write(svg(False,FONT))
