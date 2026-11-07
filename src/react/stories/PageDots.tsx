import type { PageAffordanceMeta } from '../../index.js';
import type { OverlayContext } from '../index.js';
import './pages.css';

/** A paged container's switcher dots, drawn under the strategy's invisible
 *  page buttons. Positioned from each button's layout rect. */
export function PageDots({ layout }: { layout: OverlayContext }) {
  return (
    <>
      {layout.affordances
        .filter((a) => a.id.startsWith('page:'))
        .map((a) => {
          const meta = a.meta as PageAffordanceMeta;
          return (
            <div
              key={a.id}
              className={meta.current ? 'pages-dot pages-dot--current' : 'pages-dot'}
              data-testid={`dot-${meta.page}`}
              data-current={meta.current ? 'true' : undefined}
              aria-hidden="true"
              style={{ left: a.rect.x, top: a.rect.y, width: a.rect.w, height: a.rect.h }}
            >
              {meta.page + 1}
            </div>
          );
        })}
    </>
  );
}
