import { defineEventHandler } from "h3";
import { isVisionMockEnabled } from "../utils/vision";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const inputPrice = Number(config.visionInputPricePerMillion);
  const outputPrice = Number(config.visionOutputPricePerMillion);

  return {
    mock: isVisionMockEnabled(config),
    priceConfigured:
      Number.isFinite(inputPrice) &&
      inputPrice > 0 &&
      Number.isFinite(outputPrice) &&
      outputPrice > 0,
    budget: null,
  };
});
