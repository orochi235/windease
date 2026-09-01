import './draft.css';

/** Stamped at the top of every guide chapter. Remove the import from the MDX
 *  files — or empty this component — once the prose has been through an edit. */
export function DraftBanner() {
  return (
    <aside className="gd-draft" role="note">
      <strong className="gd-draft__tag">First draft</strong>
      <span className="gd-draft__body">
        Written in one pass and not yet edited. Expect rough prose, thin sections and claims that
        have not been checked line by line against the code.
      </span>
    </aside>
  );
}
