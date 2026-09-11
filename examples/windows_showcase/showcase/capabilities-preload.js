'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const invoke=name=>(...args)=>ipcRenderer.invoke(`showcase:${name}`,...args);
contextBridge.exposeInMainWorld('showcase',{
  getCatalog:invoke('catalog'),getStatus:invoke('status'),transcribe:invoke('transcribe'),reason:invoke('reason'),refine:invoke('refine'),embed:invoke('embed'),imageAsset:invoke('image-asset'),segment:invoke('segment'),understand:invoke('understand'),geometry:invoke('geometry'),cancel:invoke('cancel'),exportResult:invoke('export'),
  startVoice:invoke('voice-start'),stopVoice:invoke('voice-stop'),resetVoice:invoke('voice-reset'),setFullscreen:invoke('fullscreen'),
  sendAudio:packet=>ipcRenderer.send('showcase:audio',packet),onEvent:callback=>{const listener=(_event,packet)=>callback(packet);ipcRenderer.on('showcase:event',listener);return()=>ipcRenderer.removeListener('showcase:event',listener);}
});
