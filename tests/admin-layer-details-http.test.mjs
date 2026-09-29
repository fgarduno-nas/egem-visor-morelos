import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
process.env.NODE_ENV ||= "test";
process.env.DATABASE_URL ||= "postgres://unused:unused@127.0.0.1:55432/test";
process.env.JWT_SECRET ||= "dummy-jwt-secret-for-local-tests";
process.env.DEFAULT_ADMIN_EMAIL ||= "admin@example.test";
process.env.DEFAULT_ADMIN_PASSWORD ||= "dummy-password";
process.env.DEFAULT_ADMIN_NAME ||= "Admin Local";
const {app}=await import("../backend/src/app.js");
const {prisma}=await import("../backend/src/config/database.js");
const {signAccessToken}=await import("../backend/src/shared/utils/jwt.js");
let server,base,original;
test.before(async()=>{
  original=prisma.layer.findMany;
  prisma.layer.findMany=async()=>Array.from({length:61},(_,index)=>({
    id:`test-${index}`,title:`Capa ${index}`,description:"Descripción",sourceType:"kmz",status:"pending_review",createdAt:"2026-09-29T16:00:00Z",updatedAt:"2026-09-29T17:00:00Z",
    createdBy:{name:"Director",email:"director@example.test",passwordHash:"NEVER_EXPOSE",role:{code:"DATA_PROVIDER"}},
    files:[{originalName:"C:\\private\\original.kmz",extension:"kmz",mimeType:"application/zip",sizeBytes:15,storagePath:"NEVER_EXPOSE"}],
    metadata:{geometryType:"Point",featureCount:2,crs:"EPSG:4326",properties:{resourceType:"vector",tags:["category:geologicos"],processingStatus:index%2?"pending":"failed",processingError:"NEVER_EXPOSE /srv/private stack password=x",isVisualizable:false,processedGeojsonPath:"NEVER_EXPOSE",source:"Fuente",responsibleAgency:"Área",updatedAt:"2026",crs:"WGS 84",scaleOrResolution:"10 m",vectorLegend:{field:"Pozos",classes:[{label:"Pozo",color:"#00ffff",order:1,geometryRole:"pozo",iconHref:"NEVER_EXPOSE"}]}}},
  }));
  server=http.createServer(app);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));base=`http://127.0.0.1:${server.address().port}/api/v1/layers/admin`;
});
test.after(async()=>{prisma.layer.findMany=original;await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();});
const request=(token,suffix="")=>fetch(base+suffix,{headers:token?{Authorization:`Bearer ${token}`}:{}});
test("real admin route authorizes only ADMIN: 401/401/403/403/200",async()=>{
  for(const [token,status] of [[null,401],["invalid",401],[signAccessToken({sub:"visitor",role:"VISITOR"}),403],[signAccessToken({sub:"director",role:"DATA_PROVIDER"}),403],[signAccessToken({sub:"admin",role:"ADMIN"}),200]])assert.equal((await request(token)).status,status);
});
test("real admin DTO paginates 10/20/50 and includes failed and pending with safe detail",async()=>{
  const token=signAccessToken({sub:"admin",role:"ADMIN"});
  for(const size of [10,20,50]){
    const response=await request(token,`?pageSize=${size}`);const {data}=await response.json();
    assert.equal(data.items.length,size);assert.equal(data.pagination.totalItems,61);
    assert.ok(data.items.some(l=>l.processingStatus==="failed"));assert.ok(data.items.some(l=>l.processingStatus==="pending"));
    const l=data.items[0];assert.equal(l.source,"Fuente");assert.equal(l.capturedCrs,"WGS 84");assert.equal(l.symbology.vector.classes[0].symbol,"triangle");assert.equal(l.files[0].originalName,"original.kmz");assert.equal(l.isVisualizable,false);
    assert.doesNotMatch(JSON.stringify(data.items),/NEVER_EXPOSE|passwordHash|storagePath|processedGeojsonPath|geospatialDiagnostics|iconHref|stack|metadata/);
  }
  const {data}=await (await request(token,"?processingStatus=failed")).json();assert.ok(data.items.every(l=>l.processingStatus==="failed"));
});
