"""
パフォーマンス計測ツール

停留所連結線の表示/非表示切替時のレンダリング時間を計測する。
ブラウザのコンソールで実行するスクリプット。
"""

const PerformanceMonitor = {
  /**
   * 停留所連結線の表示/非表示切替のパフォーマンスを計測する
   */
  measureStopConnectionToggle: async function() {
    console.group('🔍 停留所連結線の表示切替 パフォーマンス計測');
    
    if (!window.map) {
      console.error('❌ MapLibreが初期化されていません');
      console.groupEnd();
      return;
    }

    try {
      // 現在の状態を確認
      const visibility = map.getLayoutProperty('stop-connections-line', 'visibility');
      const targetVisibility = visibility === 'visible' ? 'none' : 'visible';
      const action = targetVisibility === 'visible' ? '表示' : '非表示';
      
      console.log(`現在の状態: ${visibility}, 目標: ${targetVisibility} (${action})`);
      
      // レイアウトエンジンのフラッシュを待つ
      await new Promise(resolve => {
        const onRender = () => {
          map.off('render', onRender);
          resolve();
        };
        map.on('render', onRender);
        
        // タイムアウト保護
        setTimeout(() => {
          map.off('render', onRender);
          resolve();
        }, 5000);
      });

      // レンダリング前の時刻記録
      const measurements = [];
      
      for (let i = 0; i < 3; i++) {
        const startTime = performance.now();
        const startRenderCount = map.painter?.frameId || 0;
        
        // 表示/非表示を切り替え
        map.setLayoutProperty('stop-connections-line', 'visibility', targetVisibility);
        if (map.getLayer('stop-connections-line-hit')) {
          map.setLayoutProperty('stop-connections-line-hit', 'visibility', targetVisibility);
        }
        
        // 次のレンダリング完了を待つ
        await new Promise(resolve => {
          let renderCount = 0;
          const maxWait = 100; // ms
          const interval = setInterval(() => {
            renderCount++;
            const elapsed = performance.now() - startTime;
            if (elapsed > maxWait || renderCount > 1) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        });
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        measurements.push(duration);
        console.log(`  試行${i + 1}: ${duration.toFixed(2)}ms`);
        
        // 次の試行前に状態を戻す
        await new Promise(resolve => setTimeout(resolve, 200));
        const reverseVisibility = targetVisibility === 'visible' ? 'none' : 'visible';
        map.setLayoutProperty('stop-connections-line', 'visibility', reverseVisibility);
        if (map.getLayer('stop-connections-line-hit')) {
          map.setLayoutProperty('stop-connections-line-hit', 'visibility', reverseVisibility);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // 統計
      const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const min = Math.min(...measurements);
      const max = Math.max(...measurements);
      
      console.log('\n📊 統計:');
      console.log(`  平均: ${avg.toFixed(2)}ms`);
      console.log(`  最小: ${min.toFixed(2)}ms`);
      console.log(`  最大: ${max.toFixed(2)}ms`);
      
      if (avg < 50) {
        console.log('✅ パフォーマンス良好 (平均 < 50ms)');
      } else if (avg < 100) {
        console.log('⚠️  パフォーマンス中程度 (平均 < 100ms)');
      } else {
        console.log('❌ パフォーマンス低下 (平均 >= 100ms)');
      }
      
    } catch (err) {
      console.error('❌ 計測エラー:', err);
    }
    
    console.groupEnd();
  },

  /**
   * 停留所表示/非表示切替のパフォーマンスを計測する
   */
  measureStopsToggle: async function() {
    console.group('🔍 停留所表示切替 パフォーマンス計測');
    
    if (!window.map) {
      console.error('❌ MapLibreが初期化されていません');
      console.groupEnd();
      return;
    }

    try {
      const visibility = map.getLayoutProperty('stops-circle', 'visibility');
      const targetVisibility = visibility === 'visible' ? 'none' : 'visible';
      const action = targetVisibility === 'visible' ? '表示' : '非表示';
      
      console.log(`現在の状態: ${visibility}, 目標: ${targetVisibility} (${action})`);
      
      const measurements = [];
      
      for (let i = 0; i < 3; i++) {
        const startTime = performance.now();
        
        map.setLayoutProperty('stops-circle', 'visibility', targetVisibility);
        
        await new Promise(resolve => {
          let elapsed = 0;
          const interval = setInterval(() => {
            elapsed += 10;
            if (elapsed > 100) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        });
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        measurements.push(duration);
        console.log(`  試行${i + 1}: ${duration.toFixed(2)}ms`);
        
        await new Promise(resolve => setTimeout(resolve, 200));
        const reverseVisibility = targetVisibility === 'visible' ? 'none' : 'visible';
        map.setLayoutProperty('stops-circle', 'visibility', reverseVisibility);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const min = Math.min(...measurements);
      const max = Math.max(...measurements);
      
      console.log('\n📊 統計:');
      console.log(`  平均: ${avg.toFixed(2)}ms`);
      console.log(`  最小: ${min.toFixed(2)}ms`);
      console.log(`  最大: ${max.toFixed(2)}ms`);
      
      if (avg < 50) {
        console.log('✅ パフォーマンス良好');
      } else if (avg < 100) {
        console.log('⚠️  パフォーマンス中程度');
      } else {
        console.log('❌ パフォーマンス低下');
      }
      
    } catch (err) {
      console.error('❌ 計測エラー:', err);
    }
    
    console.groupEnd();
  },

  /**
   * 使用方法を表示
   */
  help: function() {
    console.log(`
🎯 パフォーマンス計測ツール

実行方法:
  PerformanceMonitor.measureStopConnectionToggle()  - 停留所連結線の切替時間を計測
  PerformanceMonitor.measureStopsToggle()           - 停留所表示の切替時間を計測
  PerformanceMonitor.help()                        - このヘルプを表示
    `);
  }
};

// 初期化完了ログ
console.log('✅ PerformanceMonitor が読み込まれました');
console.log('実行: PerformanceMonitor.help() でヘルプを表示');
