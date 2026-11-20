/*
 * Test input method driven by adb broadcasts.
 * Adapted from Slate's TestIme (MIT License, Copyright (c) 2016-2026 Ian Storm Taylor,
 * https://github.com/ianstormtaylor/slate playwright/devices/android/ime). Added: "seq" op
 * that runs several InputConnection calls in one broadcast, with optional sleeps.
 */
package org.lexicallab.testime;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.inputmethodservice.InputMethodService;
import android.os.SystemClock;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.ExtractedText;
import android.view.inputmethod.ExtractedTextRequest;
import android.view.inputmethod.InputConnection;
import android.widget.TextView;
import java.nio.charset.StandardCharsets;

public class TestIme extends InputMethodService {
  static final String ACTION = "org.lexicallab.testime.COMMAND";

  private final BroadcastReceiver receiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
          setResultData(run(intent));
        }
      };

  @Override
  public void onCreate() {
    super.onCreate();
    registerReceiver(receiver, new IntentFilter(ACTION), Context.RECEIVER_EXPORTED);
  }

  @Override
  public void onDestroy() {
    unregisterReceiver(receiver);
    super.onDestroy();
  }

  @Override
  public View onCreateInputView() {
    TextView view = new TextView(this);
    view.setText("Lab test keyboard");
    view.setMinHeight(240);
    return view;
  }

  @Override
  public boolean onEvaluateFullscreenMode() {
    return false;
  }

  private static String b64(String encoded) {
    if (encoded == null || encoded.isEmpty()) return "";
    return new String(Base64.decode(encoded, Base64.DEFAULT), StandardCharsets.UTF_8);
  }

  private void key(InputConnection c, int code) {
    long now = SystemClock.uptimeMillis();
    c.sendKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0, 0, -1, 0,
        KeyEvent.FLAG_SOFT_KEYBOARD | KeyEvent.FLAG_KEEP_TOUCH_MODE));
    c.sendKeyEvent(new KeyEvent(now, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0, 0, -1, 0,
        KeyEvent.FLAG_SOFT_KEYBOARD | KeyEvent.FLAG_KEEP_TOUCH_MODE));
  }

  private String one(InputConnection c, String op, String text, int a, int b) {
    boolean ok;
    switch (op == null ? "" : op) {
      case "compose": ok = c.setComposingText(text, 1); break;
      case "commit": ok = c.commitText(text, 1); break;
      case "finish": ok = c.finishComposingText(); break;
      case "delete": ok = c.deleteSurroundingText(a, b); break;
      case "region": ok = c.setComposingRegion(a, b); break;
      case "select": ok = c.setSelection(a, b); break;
      case "key": key(c, a); ok = true; break;
      case "begin": ok = c.beginBatchEdit(); break;
      case "end": ok = c.endBatchEdit(); break;
      case "sleep": SystemClock.sleep(a); ok = true; break;
      case "state":
        ExtractedText e = c.getExtractedText(new ExtractedTextRequest(), 0);
        if (e == null) return "state:none";
        return "state:" + e.selectionStart + ":" + e.selectionEnd + ":" + e.text;
      default: return "error:unknown-op:" + op;
    }
    return ok ? "ok" : "error:rejected:" + op;
  }

  private String run(Intent intent) {
    InputConnection c = getCurrentInputConnection();
    if (c == null) return "error:no-input-connection";
    String op = intent.getStringExtra("op");
    if (!"seq".equals(op)) {
      return one(c, op, b64(intent.getStringExtra("b64")), intent.getIntExtra("a", 1), intent.getIntExtra("b", 0));
    }
    // seq: steps separated by ';', fields by ',': op,b64text,a,b
    StringBuilder out = new StringBuilder();
    for (String step : b64(intent.getStringExtra("b64")).split(";")) {
      if (step.isEmpty()) continue;
      String[] f = step.split(",", -1);
      String r = one(c, f[0], f.length > 1 ? b64(f[1]) : "",
          f.length > 2 && !f[2].isEmpty() ? Integer.parseInt(f[2]) : 1,
          f.length > 3 && !f[3].isEmpty() ? Integer.parseInt(f[3]) : 0);
      out.append(r).append(' ');
    }
    return out.toString().trim();
  }
}
