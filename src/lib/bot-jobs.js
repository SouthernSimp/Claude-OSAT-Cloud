/* Bots that can take a job from the line's `>` (Phase 13). Each is { id, name, run(job) }. Today none can: Settings →
   Bots holds the drop folder, cloud models and the connector, which bring things in, and OSAT's own bots come in a later
   phase. When one exists it registers here, and `>research best CRMs` reaches it with no change to the line
   (shared/launcher-model.mjs `handOff` picks the taker and says so plainly when there is none). */
export const botTakers = () => []
