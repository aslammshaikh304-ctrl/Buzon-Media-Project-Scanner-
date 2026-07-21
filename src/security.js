const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
function isPrivateAddress(address) {
  if (net.isIP(address) === 4) { const [a,b]=address.split(".").map(Number); return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a>=224; }
  if (net.isIP(address) === 6) { const v=address.toLowerCase(); return v==="::"||v==="::1"||v.startsWith("fc")||v.startsWith("fd")||/^fe[89ab]/.test(v)||v.startsWith("::ffff:127.")||v.startsWith("::ffff:10.")||v.startsWith("::ffff:192.168."); }
  return true;
}
async function assertPublicHttpUrl(value) {
  let url; try { url=new URL(value); } catch { throw new Error("Invalid website URL"); }
  if (!["http:","https:"].includes(url.protocol)||url.username||url.password) throw new Error("Only public HTTP(S) URLs are allowed");
  const addresses=await dns.lookup(url.hostname,{all:true,verbatim:true});
  if (!addresses.length||addresses.some(({address})=>isPrivateAddress(address))) throw new Error("Private or reserved network targets are not allowed");
  return url.toString();
}
function requireApiKey(req,res,next) {
  const configured=process.env.BACKEND_API_KEY;
  if (!configured||configured.length<32) return res.status(503).json({success:false,error:"Backend authentication is not configured"});
  const supplied=(req.get("authorization")||"").replace(/^Bearer\s+/,""); const a=Buffer.from(configured); const b=Buffer.from(supplied);
  if (a.length!==b.length||!crypto.timingSafeEqual(a,b)) { res.set("WWW-Authenticate","Bearer"); return res.status(401).json({success:false,error:"Unauthorized"}); }
  return next();
}
module.exports={assertPublicHttpUrl,isPrivateAddress,requireApiKey};