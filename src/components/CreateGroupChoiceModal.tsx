import { Modal } from "./Modal";
import { isCloudConfigured } from "../lib/firebase";
import type { GroupKind } from "../types";
import { Icon } from "./Icon";

interface Props {
  onPick: (kind: GroupKind) => void;
  onClose: () => void;
}

export function CreateGroupChoiceModal({ onPick, onClose }: Props) {
  const cloudOn = isCloudConfigured();

  return (
    <Modal title="How do you want to split?" onClose={onClose}>
      <button className="choice" onClick={() => onPick("local")}>
        <span className="choice-icon">
          <Icon name="notebook" size={26} />
        </span>
        <span className="choice-body">
          <b>Just me tracking</b>
          <small>
            You add everyone's names and log all the expenses yourself. Nobody else needs an
            account. Stays on this device, works fully offline.
          </small>
          <span className="choice-tag">No sign-in needed</span>
        </span>
      </button>

      <button
        className={`choice${cloudOn ? "" : " choice-disabled"}`}
        onClick={() => cloudOn && onPick("shared")}
        disabled={!cloudOn}
      >
        <span className="choice-icon">
          <Icon name="users" size={26} />
        </span>
        <span className="choice-body">
          <b>Invite real people</b>
          <small>
            Share a code, everyone signs in with Google, and any member can add expenses. Syncs
            live across devices — and still works offline.
          </small>
          <span className="choice-tag">
            {cloudOn ? "Google sign-in required" : "Cloud sync not configured"}
          </span>
        </span>
      </button>

      {!cloudOn && (
        <p className="settle-hint">
          To enable shared groups, add your Firebase keys to <code>.env.local</code> (see{" "}
          <code>.env.example</code>) and restart the dev server.
        </p>
      )}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
