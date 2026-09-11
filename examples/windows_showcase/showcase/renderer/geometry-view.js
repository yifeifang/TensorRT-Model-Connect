'use strict';

// Display only: these coordinates and colors come from the native model receipt.
// Camera normalization changes the view, never the exported geometry.
window.GeometryView=class GeometryView {
  constructor(canvas,preview,camera={}) {
    this.canvas=canvas;
    this.context=canvas.getContext('2d');
    this.camera={yaw:.32,pitch:-.12,zoom:1,...camera};
    this.disposed=false;
    this.frame=null;
    this.pointer=null;
    if(!this.context)throw new Error('The point-cloud preview is unavailable. You can still export the model result.');
    const {points,colors}=preview;
    if(!Array.isArray(points)||!Array.isArray(colors)||points.length!==colors.length||!points.length||points.length%3||points.length>36000||points.some(v=>!Number.isFinite(v))||colors.some(v=>!Number.isInteger(v)||v<0||v>255))
      throw new Error('The model returned an invalid point-cloud preview.');
    const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<points.length;i++) {const axis=i%3;low[axis]=Math.min(low[axis],points[i]);high[axis]=Math.max(high[axis],points[i]);}
    this.center=low.map((v,i)=>(v+high[i])/2);
    this.extent=Math.max(...high.map((v,i)=>v-low[i]),1e-6);
    this.points=[];
    for(let i=0;i<points.length;i+=3)this.points.push({
      x:(points[i]-this.center[0])/this.extent,
      y:(points[i+1]-this.center[1])/this.extent,
      z:(points[i+2]-this.center[2])/this.extent,
      color:`rgb(${Math.round(colors[i])},${Math.round(colors[i+1])},${Math.round(colors[i+2])})`
    });
    this.listeners={
      pointerdown:event=>{if(event.button!==0||this.pointer)return;event.preventDefault();this.pointer={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');},
      pointermove:event=>{if(this.pointer?.id!==event.pointerId)return;this.rotate((event.clientX-this.pointer.x)*.008,(event.clientY-this.pointer.y)*.008);this.pointer.x=event.clientX;this.pointer.y=event.clientY;},
      pointerup:event=>this.release(event.pointerId),
      pointercancel:event=>this.release(event.pointerId),
      lostpointercapture:event=>this.release(event.pointerId),
      wheel:event=>{event.preventDefault();this.zoom(Math.exp(-Math.max(-100,Math.min(100,event.deltaY))*.005));},
      keydown:event=>{
        const actions={ArrowLeft:()=>this.rotate(-.08,0),ArrowRight:()=>this.rotate(.08,0),ArrowUp:()=>this.rotate(0,-.08),ArrowDown:()=>this.rotate(0,.08),'+':()=>this.zoom(1.15),'=':()=>this.zoom(1.15),'-':()=>this.zoom(1/1.15),Home:()=>this.reset()};
        if(actions[event.key]){event.preventDefault();actions[event.key]();}
      }
    };
    for(const [name,handler]of Object.entries(this.listeners))canvas.addEventListener(name,handler,name==='wheel'?{passive:false}:undefined);
    this.observer=new ResizeObserver(()=>this.schedule());
    this.observer.observe(canvas);
    this.schedule();
  }

  getView(){return {...this.camera};}
  rotate(yaw,pitch){this.camera.yaw+=yaw;this.camera.pitch=Math.max(-1.3,Math.min(1.3,this.camera.pitch+pitch));this.schedule();}
  zoom(factor){this.camera.zoom=Math.max(.35,Math.min(4,this.camera.zoom*factor));this.schedule();}
  reset(){this.camera={yaw:.32,pitch:-.12,zoom:1};this.schedule();}
  release(id){if(this.pointer?.id!==id)return;this.pointer=null;if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);this.canvas.classList.remove('dragging');}
  schedule(){if(this.disposed||this.frame!==null)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.draw();});}

  draw(){
    if(this.disposed)return;
    const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
    if(!width||!height)return;
    const ratio=Math.min(window.devicePixelRatio||1,2),pixelWidth=Math.round(width*ratio),pixelHeight=Math.round(height*ratio);
    if(this.canvas.width!==pixelWidth||this.canvas.height!==pixelHeight){this.canvas.width=pixelWidth;this.canvas.height=pixelHeight;}
    const ctx=this.context;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    const cy=Math.cos(this.camera.yaw),sy=Math.sin(this.camera.yaw),cp=Math.cos(this.camera.pitch),sp=Math.sin(this.camera.pitch);
    const projected=this.points.map(point=>{
      const x=point.x*cy+point.z*sy,z=-point.x*sy+point.z*cy;
      return {x,y:point.y*cp-z*sp,z:point.y*sp+z*cp,color:point.color};
    }).sort((a,b)=>b.z-a.z);
    // Fit the complete projection, including distant predictions. No percentile
    // filtering or clipping is used to make a scene appear denser than it is.
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(const point of projected){left=Math.min(left,point.x);right=Math.max(right,point.x);top=Math.min(top,point.y);bottom=Math.max(bottom,point.y);}
    const centerX=(left+right)/2,centerY=(top+bottom)/2;
    const scale=Math.min(width*.86/Math.max(right-left,1e-6),height*.82/Math.max(bottom-top,1e-6))*this.camera.zoom;
    const size=Math.max(1.1,Math.min(3.5,Math.min(width,height)/115*this.camera.zoom));
    for(const point of projected){const x=width/2+(point.x-centerX)*scale,y=height/2+(point.y-centerY)*scale;if(x<-size||y<-size||x>width+size||y>height+size)continue;ctx.fillStyle=point.color;ctx.fillRect(x-size/2,y-size/2,size,size);}
  }

  dispose(){
    if(this.disposed)return;this.disposed=true;
    if(this.frame!==null)cancelAnimationFrame(this.frame);
    if(this.pointer)this.release(this.pointer.id);
    this.observer.disconnect();
    for(const [name,handler]of Object.entries(this.listeners))this.canvas.removeEventListener(name,handler);
    this.points=[];
  }
};
