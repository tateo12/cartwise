import { TripFlow } from '@/components/TripFlow';
import { EmptyState, Panel } from '@/components/ui';
import { buildTripView } from '@/server/trip';

export const dynamic = 'force-dynamic';

/**
 * The shopping trip: price the list, choose a plan, then order.
 *
 * Everything is computed server-side and handed down, so the client component
 * only manages which step you are on. No prices are ever computed in the
 * browser, which keeps the optimizer the single source of every total.
 */
export default function TripPage() {
  const view = buildTripView();

  if (view.empty) {
    return (
      <Panel>
        <EmptyState
          title="Nothing to plan yet"
          body="Add items to your basket and pick at least one store, then come back and hit ready."
          cta={{ href: '/items', label: 'Browse prices' }}
        />
      </Panel>
    );
  }

  return <TripFlow view={view} />;
}
