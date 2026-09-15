self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?.json()||{}}catch{data={body:event.data?.text()||'Ci sono novità in SOLDI.'}}
  event.waitUntil(self.registration.showNotification(data.title||'SOLDI',{body:data.body||'Ci sono nuove email finanziarie.',tag:'soldi-gmail',renotify:true,data:{url:data.url||'/?page=Email'}}))
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/?page=Email',self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const current=windows.find(client=>client.url.startsWith(self.location.origin));
    if(current)return current.navigate(target).then(()=>current.focus());
    return clients.openWindow(target)
  }))
});
