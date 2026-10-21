//#region lib/types/preload-app.js
/** Minimal marker that selects the desktop custom-protocol API carrier. */
require("electron").contextBridge.exposeInMainWorld("dshDesktop", { protocolVersion: 1 });
//#endregion










require('electron').contextBridge.exposeInMainWorld('labModels',{check:(id,model)=>require('electron').ipcRenderer.invoke('lab-models:check',id,model),balance:()=>require('electron').ipcRenderer.invoke('lab-models:balance'),state:()=>require('electron').ipcRenderer.invoke('lab-models:state'),refresh:()=>require('electron').ipcRenderer.invoke('lab-models:refresh'),select:(id,model)=>require('electron').ipcRenderer.invoke('lab-models:select',id,model),launch:(id,model)=>require('electron').ipcRenderer.invoke('lab-models:launch',id,model),terminal:(action,id,model)=>require('electron').ipcRenderer.invoke('lab-models:terminal',action,id,model)});
require('electron').contextBridge.exposeInMainWorld('labUsage',{load:(range)=>require('electron').ipcRenderer.invoke('lab-models:usage',range),dashboard:()=>require('electron').ipcRenderer.invoke('lab-models:dashboard')});
require('electron').contextBridge.exposeInMainWorld('labUsageDashboard',{load:()=>require('electron').ipcRenderer.invoke('lab-models:dashboard')});
