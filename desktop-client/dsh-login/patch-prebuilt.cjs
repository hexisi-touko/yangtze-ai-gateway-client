function patchPrebuilt(s){
 if(s.includes('lab-prebuilt-profile-v1'))return s;
 const anchor='verifySeedIntegrity(seedDir); this.mergeSeedPnpmState(seedDir);';
 if(!s.includes(anchor))throw Error('Prebuilt anchor missing');
 const code=String.raw`
/* lab-prebuilt-profile-v1 */
const prepared=join(dirname(seedDir),"prebuilt-profile");
if(!existsSync(this.paths.profile)&&existsSync(join(prepared,"manifest.json"))){
 const inventory=readJson(join(prepared,"manifest.json"));
 if(inventory.version!==target.version||!Array.isArray(inventory.files))throw Error("Invalid prebuilt profile manifest");
 const stagingProfile=this.newStagingProfile();
 try{
  for(const item of inventory.files){
   if(typeof item.path!=="string"||item.path.split("/").some(x=>x===".."||x==="")||isAbsolute(item.path)||item.path.includes(":"))throw Error("Invalid prebuilt path");
   const data=readFileSync(join(prepared,"profile",item.path));
   if(createHash("sha256").update(data).digest("hex")!==item.sha256)throw Error("Prebuilt profile integrity failure");
   const destination=join(stagingProfile,item.path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,data);
  }
  verifyDesktopCorePackageSet(stagingProfile,target.version);
  await hooks.healthCheck(stagingProfile);
  await this.activate(stagingProfile,hooks);
  return true;
 }catch(error){removeOwnedDirectory(stagingProfile);throw error;}
}
`;
 return s.replace(anchor,code+anchor);
}
module.exports={patchPrebuilt};
