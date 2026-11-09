import type { PublicSettings, SettingsPatch } from '../../../shared/types';

export interface SectionProps {
  settings: PublicSettings;
  /** Saves a patch through the store. A refusal from main is logged, not thrown; resolves false then. */
  update: (patch: SettingsPatch) => Promise<boolean>;
  /** As `update`, but rejects, for the one field that shows main's refusal (the hotkey, ruling R38). */
  updateOrThrow: (patch: SettingsPatch) => Promise<void>;
}
