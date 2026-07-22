# React 调试工具使用指南

本项目现已配置完整的 React 调试工具链，可以提供类似 Vue DevTools 的开发体验。

## 🔧 已配置的工具

### 1. React DevTools 浏览器扩展
- **自动检测**：浏览器扩展会自动检测 React 应用并连接
- **安装**：[React Developer Tools](https://chrome.google.com/webstore/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi)
- **使用**：打开浏览器开发者工具 (F12) 即可看到 "⚛️ Components" 标签

### 2. React DevTools 独立应用
- **高级调试**：提供更强大的调试功能
- **启动**：`npm run react:devtools`
- **自动连接**：独立应用会自动连接到开发环境的 React 应用

### 3. Source Map 支持
- Vite 已配置生成 source map
- 错误堆栈可以直接定位到源代码
- 在浏览器控制台点击文件路径可直接跳转到编辑器

### 3. VS Code 调试配置
- 在 VS Code 中按 `F5` 或点击"运行和调试"
- 选择调试配置：
  - **Debug Tauri App**: 完整的 Tauri 应用调试
  - **Debug Chrome**: 专门调试 React 组件
  - **Attach to Chrome**: 附加到已运行的 Chrome 实例

## 🚀 使用方法

### 方式一：浏览器扩展（推荐）
1. **启动开发服务器**：
   ```bash
   npm run tauri:dev
   ```

2. **安装扩展**：安装 [React Developer Tools](https://chrome.google.com/webstore/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi)

3. **打开开发者工具** (F12 或右键 → 检查)
4. **查看组件**：在开发者工具中找到 "⚛️ Components" 和 "⚛️ Profiler" 标签

### 方式二：独立 DevTools 应用
1. **启动 React DevTools**：
   ```bash
   npm run react:devtools
   ```

2. **启动开发服务器**（另一个终端）：
   ```bash
   npm run tauri:dev
   ```

3. **自动连接**：DevTools 会自动连接，显示完整的组件树和性能分析

### 方式三：VS Code 集成调试
1. 在 VS Code 中打开项目
2. 按 `F5` 或点击侧边栏的"运行和调试"
3. 选择 "Debug Tauri App" 配置
4. 设置断点并开始调试

## 🎯 主要功能

### 组件检查
- 查看完整的组件树层级
- 检查 props、state、hooks
- 查看组件渲染性能
- 定位组件定义位置

### 性能分析
- 记录组件渲染性能
- 识别不必要的重新渲染
- 分析组件更新原因
- 查看渲染时间分布

### 源代码定位
- 在控制台错误堆栈中点击文件名
- 直接跳转到 VS Code 中的对应位置
- 支持断点调试和变量查看

## 🔍 高级技巧

### Chrome 远程调试
如果需要在 Chrome 中调试：
1. 以远程调试模式启动 Chrome：
   ```bash
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

   # Windows
   chrome.exe --remote-debugging-port=9222
   ```

2. 在 VS Code 中选择 "Attach to Chrome" 配置

### React 性能优化
1. 使用 React Profiler 识别性能瓶颈
2. 查找不必要的重新渲染
3. 优化 memo 和 useMemo 的使用
4. 监控大型组件的渲染时间

### Tauri 特定调试
- Tauri 的日志会显示在终端中
- Rust 错误会直接在终端显示
- 前端错误会同时显示在浏览器和终端

## 🛠️ 故障排除

### React DevTools 无法连接
1. 确保开发服务器正在运行
2. 检查是否在开发模式 (`npm run tauri:dev`)
3. 尝试重启 React DevTools 应用

### Source Map 不工作
1. 清除浏览器缓存
2. 重新启动开发服务器
3. 检查 `vite.config.ts` 中的 `sourcemap: true` 配置

### VS Code 调试问题
1. 确保 `.vscode/launch.json` 配置正确
2. 检查端口 1420 是否被占用
3. 尝试重启 VS Code

## 📚 相关资源

- [React DevTools 官方文档](https://react.dev/learn/react-developer-tools)
- [Vite 调试文档](https://vitejs.dev/guide/debug.html)
- [Tauri 调试指南](https://tauri.app/v1/guides/debugging/)
