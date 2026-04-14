import { useEffect, useState } from 'react';
import { useAuth } from '../../store/auth';
import { useSip } from '../../store/sip';
import { getMe, type MeResponse } from '../../api/auth';
import { extractErrorMessage } from '../../api/client';
import { APP_VERSION } from '../../version';
import { brand, fonts } from '../../theme';

interface DeviceListState {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  error: string | null;
  loading: boolean;
}

export default function SettingsPage() {
  const access = useAuth((s) => s.access);
  const display_name = useAuth((s) => s.display_name);
  const extension = useAuth((s) => s.extension);
  const sip_config = useAuth((s) => s.sip_config);
  const authSignOut = useAuth((s) => s.signOut);

  const audioInput = useSip((s) => s.audioInput);
  const audioOutput = useSip((s) => s.audioOutput);
  const setAudioInput = useSip((s) => s.setAudioInput);
  const setAudioOutput = useSip((s) => s.setAudioOutput);
  const destroySip = useSip((s) => s.destroy);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const [devices, setDevices] = useState<DeviceListState>({
    inputs: [],
    outputs: [],
    error: null,
    loading: true,
  });

  // Fetch account info from /api/auth/me/ for email + role that we
  // don't have in the auth store from the initial login response.
  useEffect(() => {
    if (!access) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getMe(access);
        if (!cancelled) setMe(data);
      } catch (e) {
        if (!cancelled) setMeError(extractErrorMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [access]);

  // Enumerate audio devices. On Chromium/Electron, labels are empty
  // until getUserMedia permission has been granted — we probe with a
  // throwaway stream to trigger the prompt (if not already granted)
  // then release it immediately before enumerating.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDevices((d) => ({ ...d, loading: true, error: null }));
      try {
        // Probe for mic permission so enumerateDevices returns labels.
        const probe = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        probe.getTracks().forEach((t) => t.stop());

        const all = await navigator.mediaDevices.enumerateDevices();
        const inputs = all.filter((d) => d.kind === 'audioinput');
        const outputs = all.filter((d) => d.kind === 'audiooutput');
        if (!cancelled) {
          setDevices({ inputs, outputs, error: null, loading: false });
        }
      } catch (e) {
        if (!cancelled) {
          setDevices({
            inputs: [],
            outputs: [],
            error: e instanceof Error ? e.message : 'Device enumeration failed',
            loading: false,
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSignOut() {
    destroySip();
    await authSignOut();
  }

  const name = me?.first_name || me?.last_name
    ? `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim()
    : display_name || '—';

  return (
    <div className="ddc-settings">
      <div className="ddc-settings-inner">
        <h1 className="ddc-settings-title">Settings</h1>

        {/* ---------- Account ---------- */}
        <section className="ddc-card">
          <div className="ddc-card-header">Account</div>
          <Row label="Name" value={name} />
          <Row label="Email" value={me?.email ?? (meError ? '(error)' : 'Loading…')} />
          <Row label="Role" value={me?.role ?? (meError ? '(error)' : 'Loading…')} capitalize />
          <Row label="Extension" value={extension || '—'} mono />
          <Row label="Domain" value={sip_config?.sip_domain || '—'} mono />
          {meError && <div className="ddc-settings-error">{meError}</div>}
        </section>

        {/* ---------- Audio devices ---------- */}
        <section className="ddc-card">
          <div className="ddc-card-header">Audio</div>
          {devices.loading && (
            <div className="ddc-settings-muted">Detecting audio devices…</div>
          )}
          {devices.error && (
            <div className="ddc-settings-error">{devices.error}</div>
          )}
          {!devices.loading && !devices.error && (
            <>
              <DeviceRow
                label="Microphone"
                value={audioInput ?? ''}
                options={devices.inputs}
                onChange={(id) => { void setAudioInput(id); }}
                emptyLabel="Default microphone"
              />
              <DeviceRow
                label="Speaker"
                value={audioOutput ?? ''}
                options={devices.outputs}
                onChange={(id) => { void setAudioOutput(id); }}
                emptyLabel="Default speaker"
              />
              <div className="ddc-settings-note">
                Microphone change applies to the next call. Speaker change
                applies immediately.
              </div>
            </>
          )}
        </section>

        {/* ---------- About ---------- */}
        <section className="ddc-card">
          <div className="ddc-card-header">About</div>
          <Row label="App version" value={APP_VERSION} mono />
          <Row label="SIP transport" value="mod_sofia WSS :7443" mono />
        </section>

        {/* ---------- Sign out ---------- */}
        <div className="ddc-signout-row">
          <button className="ddc-signout-btn" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      <style>{`
        .ddc-settings {
          min-height: 100%;
          padding: 36px 40px 60px;
          font-family: ${fonts.sans};
          overflow-y: auto;
        }
        .ddc-settings-inner {
          max-width: 720px;
          margin: 0 auto;
        }
        .ddc-settings-title {
          color: ${brand.white};
          font-size: 28px;
          font-weight: 800;
          letter-spacing: 1px;
          margin: 0 0 24px;
          text-transform: uppercase;
        }
        .ddc-card {
          background: rgba(7, 20, 64, 0.55);
          border: 1px solid rgba(77, 166, 255, 0.18);
          border-radius: 12px;
          padding: 18px 22px;
          margin-bottom: 18px;
        }
        .ddc-card-header {
          color: ${brand.blue};
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          margin-bottom: 14px;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(77, 166, 255, 0.15);
        }
        .ddc-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px dashed rgba(77, 166, 255, 0.08);
        }
        .ddc-row:last-child { border-bottom: none; }
        .ddc-row-label {
          color: ${brand.textMuted};
          font-size: 12px;
          letter-spacing: 1.2px;
          text-transform: uppercase;
        }
        .ddc-row-value {
          color: ${brand.white};
          font-size: 14px;
          max-width: 60%;
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ddc-row-value.mono { font-family: ${fonts.mono}; letter-spacing: 0.5px; }
        .ddc-row-value.cap  { text-transform: capitalize; }

        .ddc-device-row {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px 0;
          border-bottom: 1px dashed rgba(77, 166, 255, 0.08);
        }
        .ddc-device-row:last-of-type { border-bottom: none; }
        .ddc-device-row label {
          color: ${brand.textMuted};
          font-size: 12px;
          letter-spacing: 1.2px;
          text-transform: uppercase;
        }
        .ddc-device-row select {
          background: ${brand.navy};
          color: ${brand.white};
          border: 1px solid rgba(77, 166, 255, 0.35);
          border-radius: 8px;
          padding: 10px 12px;
          font-family: ${fonts.sans};
          font-size: 13px;
          cursor: pointer;
          outline: none;
        }
        .ddc-device-row select:focus {
          border-color: ${brand.blue};
          box-shadow: 0 0 0 3px rgba(77, 166, 255, 0.15);
        }

        .ddc-settings-muted {
          color: ${brand.textMuted};
          font-size: 13px;
          padding: 8px 0;
        }
        .ddc-settings-error {
          color: ${brand.red};
          font-size: 13px;
          padding: 8px 0;
        }
        .ddc-settings-note {
          color: ${brand.textMuted};
          font-size: 11px;
          margin-top: 12px;
          font-style: italic;
        }

        .ddc-signout-row {
          display: flex;
          justify-content: flex-end;
          margin-top: 18px;
        }
        .ddc-signout-btn {
          background: transparent;
          color: ${brand.red};
          border: 1px solid ${brand.red};
          border-radius: 8px;
          padding: 10px 28px;
          font-family: ${fonts.sans};
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 2px;
          text-transform: uppercase;
          cursor: pointer;
          transition: background-color 120ms, color 120ms;
        }
        .ddc-signout-btn:hover {
          background: ${brand.red};
          color: #fff;
        }
      `}</style>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}) {
  const cls = [
    'ddc-row-value',
    mono ? 'mono' : '',
    capitalize ? 'cap' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="ddc-row">
      <span className="ddc-row-label">{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
}

function DeviceRow({
  label,
  value,
  options,
  onChange,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: MediaDeviceInfo[];
  onChange: (id: string) => void;
  emptyLabel: string;
}) {
  return (
    <div className="ddc-device-row">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {options.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Device ${d.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
