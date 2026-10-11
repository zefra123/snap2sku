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
  background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiB2aWV3Qm94PSIwIDAgMzAwIDMwMCI+CiAgPCEtLSDlj6/lubPpk7rnmoTmnoHmt6HnurjlvKDpopfnspLlupXnurnvvJrmmpbopJDoibLlmarngrnvvIxhbHBoYSDnlLHlmarlo7Dkuq7luqbpqbHliqggLS0+CiAgPGZpbHRlciBpZD0icHQtZ3JhaW4iIHg9IjAiIHk9IjAiIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiPgogICAgPGZlVHVyYnVsZW5jZSB0eXBlPSJmcmFjdGFsTm9pc2UiIGJhc2VGcmVxdWVuY3k9IjAuODIiIG51bU9jdGF2ZXM9IjIiIHN0aXRjaFRpbGVzPSJzdGl0Y2giIHJlc3VsdD0ibm9pc2UiLz4KICAgIDxmZUNvbG9yTWF0cml4IGluPSJub2lzZSIgdHlwZT0ibWF0cml4IgogICAgICB2YWx1ZXM9IjAgMCAwIDAgMC4yNAogICAgICAgICAgICAgIDAgMCAwIDAgMC4yMAogICAgICAgICAgICAgIDAgMCAwIDAgMC4xNQogICAgICAgICAgICAgIDAuMDcgMC4wNyAwLjA3IDAgMCIvPgogIDwvZmlsdGVyPgogIDxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiBmaWx0ZXI9InVybCgjcHQtZ3JhaW4pIi8+Cjwvc3ZnPgo=");
  background-repeat: repeat;
  background-size: 300px 300px;
  color: var(--c-ink);
  font-family: var(--font-body);
  font-size: var(--font-base);
}
button {
  border-radius: var(--radius);
}
</style>
