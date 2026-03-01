<script lang="ts">
  import type { Geometry, LandsInfo } from '$lib/types.js';
  import { formatName } from '$lib/quiz.js';

  interface Props {
    geometry: Geometry;
    landsInfo: LandsInfo;
    viewBox: string;
    regionIds: string[];
    /** Countries already correctly found — show their names permanently */
    foundIds?: string[];
    /** Country the user just clicked wrongly — flash its name briefly */
    wrongFlashId?: string;
    /** Country just answered correctly — highlight green briefly */
    correctFlashId?: string;
    quizActive?: boolean;
    onLandClick?: (id: string) => void;
  }

  let {
    geometry,
    landsInfo,
    viewBox,
    regionIds,
    foundIds = [],
    wrongFlashId = '',
    correctFlashId = '',
    quizActive = false,
    onLandClick = () => {}
  }: Props = $props();

  const FILL_COLORS = [
    '#6fa8c0', '#6aacdc', '#79bb8d', '#c4a84f', '#a87abf',
    '#c8784c', '#52b3a0', '#c4b94a', '#c07070', '#5890c0',
    '#87be70', '#c8a070', '#9880c0', '#70be88'
  ];

  function getFill(id: string): string {
    if (id === correctFlashId) return '#51cf66';
    if (id === wrongFlashId)   return '#ff6b6b';
    if (foundIds.includes(id)) return '#3d8a50';
    const n = landsInfo[id]?.fillColorNumber ?? 0;
    return FILL_COLORS[n % FILL_COLORS.length];
  }

  function getStroke(id: string): string {
    if (id === correctFlashId || id === wrongFlashId) return '#fff';
    if (foundIds.includes(id)) return 'rgba(255,255,255,0.5)';
    return 'rgba(255,255,255,0.25)';
  }

  // Labels to render: found countries (permanent) + wrong flash (temporary)
  type LabelEntry = { id: string; color: string };
  let labels = $derived<LabelEntry[]>([
    ...foundIds.map(id => ({ id, color: '#ffffff' })),
    ...(wrongFlashId ? [{ id: wrongFlashId, color: '#ffcc66' }] : []),
    ...(correctFlashId ? [{ id: correctFlashId, color: '#ffffff' }] : [])
  ]);
</script>

<svg
  {viewBox}
  xmlns="http://www.w3.org/2000/svg"
  class="world-map"
  preserveAspectRatio="xMidYMid meet"
>
  <!-- Land shapes -->
  {#each regionIds as id (id)}
    {#if geometry[id]}
      {@const fill = getFill(id)}
      {@const stroke = getStroke(id)}
      {#each [...(geometry[id].land ?? []), ...(geometry[id].island ?? [])] as d, i (i)}
        <path
          {d}
          {fill}
          {stroke}
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
          class:clickable={quizActive}
          onclick={() => quizActive && onLandClick(id)}
          role={quizActive ? 'button' : undefined}
          aria-label={quizActive ? id : undefined}
        />
      {/each}
    {/if}
  {/each}

  <!-- Country name labels -->
  {#each labels as { id, color } (id + color)}
    {@const info = landsInfo[id]}
    {#if info?.cx !== undefined && info.cy !== undefined}
      <text
        x={info.cx}
        y={info.cy}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size={info.lw ?? 70}
        font-weight="700"
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        fill={color}
        stroke="#0d1b2e"
        stroke-width={info.lw ? info.lw * 0.3 : 20}
        paint-order="stroke"
        pointer-events="none"
      >
        {formatName(id)}
      </text>
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
    transition: fill 0.12s ease;
  }

  .clickable {
    cursor: pointer;
  }

  .clickable:hover {
    opacity: 0.75;
  }
</style>
