/* ==========================================================================
   HD2Lab | DOS Player — game library data
   Bundles stay where they were (v8.js-dos.com public CDN); only metadata and
   the locally captured thumbnails live here.
   `kind` splits the play library from the benchmark entry.
   ========================================================================== */

export const GAMES = [
  {
    id: 'digger',
    name: 'Digger',
    badge: 'DG',
    year: 1983,
    maker: 'Windmill Software',
    genre: '아케이드',
    size: '27 KB',
    license: 'Freeware',
    kind: 'library',
    thumb: 'thumbs/digger.png',
    url: 'https://v8.js-dos.com/bundles/digger.jsdos',
    blurb: '땅을 파고 보석을 캐는 1983년 아케이드. 노블을 피해 다 캐면 다음 스테이지로.',
  },
  {
    id: 'doom',
    name: 'DOOM',
    badge: 'DM',
    year: 1993,
    maker: 'id Software',
    genre: 'FPS',
    size: '5.3 MB',
    license: 'Shareware',
    kind: 'library',
    pad: 'doom',
    thumb: 'thumbs/doom.png',
    url: 'https://v8.js-dos.com/bundles/doom.jsdos',
    blurb: '셰어웨어 에피소드 1 “Knee-Deep in the Dead”. W·S 이동, ←→ 회전, Ctrl 사격.',
  },
  {
    id: 'dhrystone',
    name: 'Dhrystone 2',
    badge: 'DH',
    year: 1984,
    maker: 'R. P. Weicker',
    genre: '벤치마크',
    size: '175 KB',
    license: 'Benchmark',
    kind: 'benchmark',
    thumb: 'thumbs/dhrystone.png',
    url: 'https://v8.js-dos.com/bundles/dhry2.jsdos',
    blurb: 'DOS/4GW 위에서 도는 Dhrystone 2.1. 이 브라우저의 DOS 연산 성능을 숫자로 재어 봅니다.',
  },
];

export function findGame(id) {
  return GAMES.find((game) => game.id === id) || null;
}

export function gamesOfKind(kind) {
  return GAMES.filter((game) => game.kind === kind);
}
