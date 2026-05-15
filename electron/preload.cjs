const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronRuntime", {
  getRuntimeApiBaseUrl: () => ipcRenderer.invoke("runtime:getApiBaseUrl"),
  getRealBackendUrl: () => ipcRenderer.invoke("runtime:getRealBackendUrl"),
  getOrCreateClientId: () => ipcRenderer.invoke("runtime:getOrCreateClientId"),
  readUserSettings: () => ipcRenderer.invoke("settings:read"),
  writeUserSettings: (patch) => ipcRenderer.invoke("settings:write", patch),
  getUserSettingsFilePath: () => ipcRenderer.invoke("settings:path"),
  setProxyTarget: (url) => ipcRenderer.invoke("proxy:setTarget", url),
  getLocalApiProxyBaseUrl: () => ipcRenderer.invoke("proxy:getBaseUrl"),
  getApiProxyListenPort: () => ipcRenderer.invoke("proxy:getListenPort"),
  getLogPaths: () => ipcRenderer.invoke("log:getPaths"),
});
