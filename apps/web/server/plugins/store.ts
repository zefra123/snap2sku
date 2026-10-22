import { initializeStore, resolveDataDirectory } from "../utils/store";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();
  const directory = resolveDataDirectory(config.dataDir);
  initializeStore(directory);
  console.log(`[store] 数据目录: ${directory}`);
});
