/**
 * Shipped campaign levels L1-L60 (PRD §7.9), parsed `LevelJson`, keyed by id.
 * Metro's static analyzer only resolves `require()`/`import` targets that are
 * string literals, never a dynamic `` `../levels/${id}.json` `` path — so this
 * is 60 explicit imports (same pattern `ftueLevels.ts` already uses for L1-L5),
 * not a loop. L1-L5 are included too (not just L6-L60): §7.5's WinScreen/
 * FailScreen progression loop treats "play level N" uniformly, and re-parsing
 * the same 5 JSON files `ftueLevels.ts` also parses is harmless (pure zod).
 */
import l001 from '../levels/001.json';
import l002 from '../levels/002.json';
import l003 from '../levels/003.json';
import l004 from '../levels/004.json';
import l005 from '../levels/005.json';
import l006 from '../levels/006.json';
import l007 from '../levels/007.json';
import l008 from '../levels/008.json';
import l009 from '../levels/009.json';
import l010 from '../levels/010.json';
import l011 from '../levels/011.json';
import l012 from '../levels/012.json';
import l013 from '../levels/013.json';
import l014 from '../levels/014.json';
import l015 from '../levels/015.json';
import l016 from '../levels/016.json';
import l017 from '../levels/017.json';
import l018 from '../levels/018.json';
import l019 from '../levels/019.json';
import l020 from '../levels/020.json';
import l021 from '../levels/021.json';
import l022 from '../levels/022.json';
import l023 from '../levels/023.json';
import l024 from '../levels/024.json';
import l025 from '../levels/025.json';
import l026 from '../levels/026.json';
import l027 from '../levels/027.json';
import l028 from '../levels/028.json';
import l029 from '../levels/029.json';
import l030 from '../levels/030.json';
import l031 from '../levels/031.json';
import l032 from '../levels/032.json';
import l033 from '../levels/033.json';
import l034 from '../levels/034.json';
import l035 from '../levels/035.json';
import l036 from '../levels/036.json';
import l037 from '../levels/037.json';
import l038 from '../levels/038.json';
import l039 from '../levels/039.json';
import l040 from '../levels/040.json';
import l041 from '../levels/041.json';
import l042 from '../levels/042.json';
import l043 from '../levels/043.json';
import l044 from '../levels/044.json';
import l045 from '../levels/045.json';
import l046 from '../levels/046.json';
import l047 from '../levels/047.json';
import l048 from '../levels/048.json';
import l049 from '../levels/049.json';
import l050 from '../levels/050.json';
import l051 from '../levels/051.json';
import l052 from '../levels/052.json';
import l053 from '../levels/053.json';
import l054 from '../levels/054.json';
import l055 from '../levels/055.json';
import l056 from '../levels/056.json';
import l057 from '../levels/057.json';
import l058 from '../levels/058.json';
import l059 from '../levels/059.json';
import l060 from '../levels/060.json';
import { levelSchema, type LevelJson } from './schema';

const RAW: readonly unknown[] = [
  l001,
  l002,
  l003,
  l004,
  l005,
  l006,
  l007,
  l008,
  l009,
  l010,
  l011,
  l012,
  l013,
  l014,
  l015,
  l016,
  l017,
  l018,
  l019,
  l020,
  l021,
  l022,
  l023,
  l024,
  l025,
  l026,
  l027,
  l028,
  l029,
  l030,
  l031,
  l032,
  l033,
  l034,
  l035,
  l036,
  l037,
  l038,
  l039,
  l040,
  l041,
  l042,
  l043,
  l044,
  l045,
  l046,
  l047,
  l048,
  l049,
  l050,
  l051,
  l052,
  l053,
  l054,
  l055,
  l056,
  l057,
  l058,
  l059,
  l060,
];

/** Every shipped level, in id order (L1..L60), already through both §7.7 gates. */
export const LEVELS: readonly LevelJson[] = RAW.map((json) => levelSchema.parse(json) as LevelJson);

export const MAX_LEVEL_ID = LEVELS.length;

/** Level `id` -> parsed `LevelJson`, or `undefined` past the shipped range. */
export function getLevel(id: number): LevelJson | undefined {
  return LEVELS.find((l) => l.id === id);
}
