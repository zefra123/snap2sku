import {
  assertProductionAccessCodeConfigured,
  assertProductionDataDirectoryConfigured,
  assertProductionUploadSigningSecretConfigured,
} from "../utils/access-code";

export default defineNitroPlugin(() => {
  const { accessCode } = useRuntimeConfig();
  assertProductionAccessCodeConfigured(
    process.env.NODE_ENV === "production",
    String(accessCode ?? ""),
  );
  const { uploadSigningSecret } = useRuntimeConfig();
  assertProductionUploadSigningSecretConfigured(
    process.env.NODE_ENV === "production",
    String(uploadSigningSecret ?? ""),
  );
  const { dataDir } = useRuntimeConfig();
  assertProductionDataDirectoryConfigured(
    process.env.NODE_ENV === "production",
    dataDir,
  );
});
