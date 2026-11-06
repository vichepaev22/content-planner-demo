const key='content-planner:vps-tab-session:v1';
const lifetime=8*3600000;
export function saveTabSession(storage,session){
  try{storage.setItem(key,JSON.stringify({version:1,origin:session.origin,token:session.token,expiresAt:session.expiresAt}));}catch{}
}
export function clearTabSession(storage){try{storage.removeItem(key);}catch{}}
export function restoreTabSession(storage,origin,now=Date.now()){
  try{
    const s=JSON.parse(storage.getItem(key));
    if(s?.version===1&&s.origin===origin&&/^[A-Za-z0-9_-]{43}$/.test(s.token)&&Number.isFinite(s.expiresAt)&&s.expiresAt>now&&s.expiresAt<=now+lifetime)return {origin:s.origin,token:s.token,expiresAt:s.expiresAt};
  }catch{}
  clearTabSession(storage);return null;
}
