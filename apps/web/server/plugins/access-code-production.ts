import { assertProductionAccessCodeConfigured } from "../utils/access-code";

export default defineNitroPlugin(() => {
  const { accessCode } = useRuntimeConfig();
  assertProductionAccessCodeConfigured(
    process.env.NODE_ENV === "production",
    String(accessCode ?? ""),
  );
});
