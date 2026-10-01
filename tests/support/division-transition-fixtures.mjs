export const historicalCategories = ['geologicos','hidrometeorologicos','quimicos-tecnologicos','sanitario-ecologico','socio-organizativo','astronomicos','limites','otras'];
// Use the previous generated Prisma Client: unsupported model fields fail here.
export async function seedTransitionFixtures(prisma, passwordHash, storagePath) {
  await prisma.role.create({data:{id:'role',code:'ADMIN',name:'Fixture administrator'}});
  await prisma.user.create({data:{id:'owner',name:'Synthetic owner',email:'fixture@example.test',passwordHash,roleId:'role'}});
  const date = new Date('2020-01-02T03:04:05Z');
  for (let index=0;index<10;index++) {
    const category=historicalCategories[index%8];
    const asset=typeof storagePath==='function' ? await storagePath(`l${index}`,category) : {storagePath,sizeBytes:1};
    await prisma.layer.create({data:{id:`l${index}`,title:`Historical ${category} ${index}`,slug:`fixture-${index}`,createdById:'owner',
      status:index===9?'draft':'published',isDeleted:index===8,deletedAt:index===8?date:null,
      createdAt:date,updatedAt:date,publishedAt:index===9?null:date,
      metadata:{create:{featureCount:1,geometryType:'Point',crs:'EPSG:4326',properties:{tags:[`category:${category}`],isVisualizable:true,processingStatus:'processed',processedGeojsonPath:asset.storagePath,...(asset.publicUrl?{processedGeojsonUrl:asset.publicUrl}:{}),vectorLegend:{classes:[{label:'Intact',color:'#123456'}]}}}},
      files:{create:{originalName:'fixture.geojson',storedName:'fixture.geojson',storagePath:asset.storagePath,mimeType:'application/geo+json',extension:'geojson',sizeBytes:asset.sizeBytes,uploadedById:'owner'}}
    }});
  }
}
