// Loads the jest-dom matchers (toBeInTheDocument, ...) for every renderer test.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
