// パフォーマンス計測ツール
// 停留所連結線や停留所表示の切り替え時間を、ブラウザのコンソールから計測する。

globalThis.PerformanceMonitor = {
  _getMap: function() {
    return window.__linemapMap || window.map || null;
  },

  /**
   * 停留所連結線の表示/非表示切替のパフォーマンスを計測する
   */
  measureStopConnectionToggle: async function() {
    console.group('🔍 停留所連結線の表示切替 パフォーマンス計測');
    
    const map = this._getMap();
    if (!map) {
      console.error('❌ MapLibreが初期化されていません');
      console.groupEnd();
      return;
    }

    let initialVisibility = 'visible';
    try {
      initialVisibility = map.getLayoutProperty('stop-connections-line', 'visibility') || 'visible';
      const targetVisibility = initialVisibility === 'visible' ? 'none' : 'visible';
      const action = targetVisibility === 'visible' ? '表示' : '非表示';
      
      console.log(`現在の状態: ${initialVisibility}, 目標: ${targetVisibility} (${action})`);
      
      const measurements = [];
      
      for (let i = 0; i < 3; i++) {
        const startTime = performance.now();
        
        map.setLayoutProperty('stop-connections-line', 'visibility', targetVisibility);
        if (map.getLayer('stop-connections-line-hit')) {
          map.setLayoutProperty('stop-connections-line-hit', 'visibility', targetVisibility);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        measurements.push(duration);
        console.log(`  試行${i + 1}: ${duration.toFixed(2)}ms`);
        
        await new Promise(resolve => setTimeout(resolve, 150));
        map.setLayoutProperty('stop-connections-line', 'visibility', initialVisibility);
        if (map.getLayer('stop-connections-line-hit')) {
          map.setLayoutProperty('stop-connections-line-hit', 'visibility', initialVisibility);
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
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
    } finally {
      if (map && map.getLayer('stop-connections-line')) {
        map.setLayoutProperty('stop-connections-line', 'visibility', initialVisibility);
        if (map.getLayer('stop-connections-line-hit')) {
          map.setLayoutProperty('stop-connections-line-hit', 'visibility', initialVisibility);
        }
      }
    }
    
    console.groupEnd();
  },

  /**
   * 停留所表示/非表示切替のパフォーマンスを計測する
   */
  measureStopsToggle: async function() {
    console.group('🔍 停留所表示切替 パフォーマンス計測');
    
    const map = this._getMap();
    if (!map) {
      console.error('❌ MapLibreが初期化されていません');
      console.groupEnd();
      return;
    }

    let initialVisibility = 'visible';
    try {
      initialVisibility = map.getLayoutProperty('stops-circle', 'visibility') || 'visible';
      const targetVisibility = initialVisibility === 'visible' ? 'none' : 'visible';
      const action = targetVisibility === 'visible' ? '表示' : '非表示';
      
      console.log(`現在の状態: ${initialVisibility}, 目標: ${targetVisibility} (${action})`);
      
      const measurements = [];
      
      for (let i = 0; i < 3; i++) {
        const startTime = performance.now();
        
        map.setLayoutProperty('stops-circle', 'visibility', targetVisibility);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        measurements.push(duration);
        console.log(`  試行${i + 1}: ${duration.toFixed(2)}ms`);
        
        await new Promise(resolve => setTimeout(resolve, 150));
        map.setLayoutProperty('stops-circle', 'visibility', initialVisibility);
        await new Promise(resolve => setTimeout(resolve, 150));
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
    } finally {
      if (map && map.getLayer('stops-circle')) {
        map.setLayoutProperty('stops-circle', 'visibility', initialVisibility);
      }
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

console.log('✅ PerformanceMonitor が読み込まれました');
console.log('実行: PerformanceMonitor.help() でヘルプを表示');
