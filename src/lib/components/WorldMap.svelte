<script lang="ts">
  import type { Geometry, LandsInfo } from '$lib/types.js';

  interface Props {
    geometry: Geometry;
    landsInfo: LandsInfo;
    viewBox: string;
    regionIds: string[];
    targetId?: string;
    revealId?: string;
    clickedId?: string;
    quizActive?: boolean;
    onLandClick?: (id: string) => void;
  }

  let {
    geometry,
    landsInfo,
    viewBox,
    regionIds,
    targetId = '',
    revealId = '',
    clickedId = '',
    quizActive = false,
    onLandClick = () => {}
  }: Props = $props();

  // 14-colour map palette — chosen so adjacent lands look distinct
  const FILL_COLORS = [
    '#6fa8c0', // 0 – slate blue
    '#6aacdc', // 1 – blue
    '#79bb8d', // 2 – green
    '#c4a84f', // 3 – gold
    '#a87abf', // 4 – purple
    '#c8784c', // 5 – orange
    '#52b3a0', // 6 – teal
    '#c4b94a', // 7 – yellow
    '#c07070', // 8 – rose
    '#5890c0', // 9 – steel blue
    '#87be70', // 10 – sage
    '#c8a070', // 11 – sand
    '#9880c0', // 12 – lavender
    '#70be88'  // 13 – mint
  ];

  function getFill(id: string): string {
    if (id === targetId) return '#51cf66';          // correct target – green
    if (id === revealId) return '#ffd43b';          // revealed answer – amber
    if (id === clickedId && id !== targetId) return '#ff6b6b'; // wrong click – red
    const n = landsInfo[id]?.fillColorNumber ?? 0;
    return FILL_COLORS[n % FILL_COLORS.length];
  }

  function getStroke(id: string): string {
    if (id === targetId || id === revealId) return '#fff';
    if (id === clickedId) return '#fff';
    return 'rgba(255,255,255,0.25)';
  }

  function getOpacity(id: string): number {
    if (!quizActive) return 1;
    // Dim all lands slightly during quiz so the target stands out when revealed
    return 0.9;
  }
</script>

<svg
  {viewBox}
  xmlns="http://www.w3.org/2000/svg"
  class="world-map"
  preserveAspectRatio="xMidYMid meet"
>
  {#each regionIds as id (id)}
    {#if geometry[id]}
      {@const fill = getFill(id)}
      {@const stroke = getStroke(id)}
      {@const opacity = getOpacity(id)}
      {@const clickable = quizActive}
      {#each [...(geometry[id].land ?? []), ...(geometry[id].island ?? [])] as d, i (i)}
        <path
          {d}
          {fill}
          {stroke}
          {opacity}
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
          class:clickable
          onclick={() => clickable && onLandClick(id)}
          role={clickable ? 'button' : undefined}
          aria-label={clickable ? id : undefined}
        />
      {/each}
    {/if}
  {/each}
</svg>

<style>
  .world-map {
    width: 100%;
    height: 100%;
    display: block;
    background: #0d1b2e;
  }

  path {
    transition: fill 0.15s ease, opacity 0.15s ease;
  }

  .clickable {
    cursor: pointer;
  }

  .clickable:hover {
    opacity: 0.75 !important;
  }
</style>
