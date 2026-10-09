import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// DCloud publishes this plugin as CommonJS with an __esModule wrapper.
const uniFactory = (uni as unknown as { default: typeof uni }).default;

export default defineConfig({
  plugins: [uniFactory()],
});
