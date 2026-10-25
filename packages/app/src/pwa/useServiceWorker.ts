import { useEffect, useSyncExternalStore } from 'react';
import { getPwaController, type ISwController, type ISwState } from './serviceWorker';

/**
 * SW 更新状态钩子（specs/pwa §10）：订阅控制器状态镜像 +
 * visibilitychange（转可见）节流 update。controller 可注入供渲染测试。
 */
export function usePwaUpdate(controller: ISwController = getPwaController()): {
  visible: boolean;
  applying: boolean;
  ready: boolean;
  apply: () => void;
  dismiss: () => void;
} {
  const state: ISwState = useSyncExternalStore(controller.subscribe, controller.getState);

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) controller.checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [controller]);

  return {
    visible: state.available && !state.dismissed,
    applying: state.applying,
    ready: state.ready,
    apply: controller.apply,
    dismiss: controller.dismiss,
  };
}
