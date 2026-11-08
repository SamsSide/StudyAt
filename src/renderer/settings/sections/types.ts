import type { PublicSettings, SettingsPatch } from '../../../shared/types';

export interface SectionProps {
  settings: PublicSettings;
  /** Saves a patch through the store. A refusal from main is logged, not thrown; resolves false then. */
  update: (patch: SettingsPatch) => Promise<boolean>;
  /** As `update`, but rejects with main's message, for fields that show it (the hotkey). */
  updateOrThrow: (patch: SettingsPatch) => Promise<void>;
}
