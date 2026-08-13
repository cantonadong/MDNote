<script lang="ts">
  let { name, size = 18 }: { name: string; size?: number } = $props();
</script>

<span class="raster-icon" style={`--icon-size:${size}px`} aria-hidden="true">
  <img src={`/icons/${name}.png`} alt="" draggable="false" />
</span>

<style>
  .raster-icon { display:inline-flex; align-items:center; justify-content:center; width:var(--icon-size); height:var(--icon-size); flex:0 0 var(--icon-size); overflow:hidden; pointer-events:none; }
  img { display:block; width:100%; height:100%; object-fit:contain; object-position:center; user-select:none; -webkit-user-drag:none; }
</style>
