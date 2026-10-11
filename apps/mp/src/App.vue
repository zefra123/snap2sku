<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";

onLaunch(() => {
  console.info("snap2sku mini program started");
});
</script>

<style>
@import "./styles/tokens.wxss";

page {
  background: var(--c-bg);
  color: var(--c-ink);
  font-family: var(--font-body);
  font-size: var(--font-base);
}
button {
  border-radius: var(--radius);
}
</style>
