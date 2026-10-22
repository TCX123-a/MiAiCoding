// P1 原型 preload —— 最小 IPC 面（contextIsolation + sandbox）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wpHost', {
  list: () => ipcRenderer.invoke('wp:list'),
  winState: () => ipcRenderer.invoke('wp:winstate:get'),
  protoStats: () => ipcRenderer.invoke('wp:proto-stats'),
  tick: (sample) => ipcRenderer.send('wp:tick', sample),
  onWinState: (fn) => {
    const h = (_e, s) => fn(s);
    ipcRenderer.on('wp:winstate', h);
    return () => ipcRenderer.removeListener('wp:winstate', h);
  },
});
