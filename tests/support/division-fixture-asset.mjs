import fs from 'node:fs/promises';
import path from 'node:path';
import {buildPublicFileUrl} from '../../backend/src/shared/utils/file-utils.js';

// The caller owns a temporary working directory and configures UPLOAD_BASE_DIR=uploads.
export async function writeFixtureAsset(directory, publicBaseUrl, id, category='geologicos') {
  if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('Invalid synthetic layer ID');
  const storagePath=`uploads/processed/${id}/layer.geojson`;
  const file=path.join(directory,storagePath);
  const geojson={type:'FeatureCollection',features:[{type:'Feature',id,
    properties:{name:`Synthetic ${id}`,layerId:id,category,color:'#123456'},
    geometry:{type:'Point',coordinates:[-99.1,18.8]}}]};
  const content=JSON.stringify(geojson);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,content,{encoding:'utf8',flag:'wx'});
  return {storagePath,publicUrl:buildPublicFileUrl(publicBaseUrl,storagePath),sizeBytes:Buffer.byteLength(content)};
}
