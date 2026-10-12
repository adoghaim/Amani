import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { ClinicalObservation, ModelProseText } from '../../src/components/ClinicalObservation';
import { authorizeModelProse, createMovementClaim, describeMeasuredMovement } from '../../src/lib/scoring/insightCopy';
import { contaminatedMovement, legitimateMovement } from './client-prose-input';

// Controlled synthetic measurements, issued through the production claim factory.
// No test implementation of authorization or rendering lives here.
const movement = {
  displayName: 'TSH', previousValue: 6, currentValue: 9, unit: 'uIU/mL',
  significance: 'significant' as const,
};
const claim = createMovementClaim(movement);
const proposals = [legitimateMovement, contaminatedMovement];
const items = authorizeModelProse('interpretation.summary_bullets', proposals, [claim]);
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture mount');
createRoot(root).render(h('main', null,
  h('h1', null, 'Client prose authorization fixture'),
  h('section', { 'aria-label': 'Measured observation' },
    h(ClinicalObservation, { language: describeMeasuredMovement(movement) })),
  h('section', { 'aria-label': 'Model summary' }, h(ModelProseText, { items })),
));
