# MCP Server Service

ModdableでMCPサーバーを実装するためのクラスです。Model Context Protocol（Streamable HTTP Transport）に準拠した実装で、Stack-chanのツールやサービスをAIクライアントから利用できるようにします。

## 機能

✅ **実装完了した機能:**
- Model Context Protocol v2024-11-05対応
- Streamable HTTP Transport実装
- JSON-RPC 2.0プロトコル対応
- 動的ツール登録・削除
- エラーハンドリング
- TypeScript型定義

## API

### エンドポイント

- `GET /health` - ヘルスチェック
- `POST /mcp` - MCPプロトコルメッセージ

### サポートするMCPメソッド

- `initialize` - プロトコル初期化
- `tools/list` - 利用可能ツールのリスト取得
- `tools/call` - ツールの実行

## 使用方法

```typescript
import { MCPServerService, type Tool } from 'mcp-server'

// ツールの定義
const helloTool: Tool = {
  name: 'hello_world',
  description: 'Returns a greeting message',
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: 'The name to greet',
      required: false
    }
  ],
  handler: async (args) => {
    const name = args.name || 'World'
    return `Hello, ${name}!`
  }
}

// サーバーの起動
const server = new MCPServerService({
  port: 8080,
  tools: [helloTool]
})
```

## 設定

インスタンス化時に以下を設定できます：

* `port`: ポート番号（デフォルト: `8080`）
* `tools`: ツールのリスト（デフォルト: 空配列）

### ツール定義

各ツールは以下の形式で定義します：

```typescript
interface Tool {
  name: string                    // ツール名
  description: string             // ツールの説明
  parameters: ToolParameter[]     // パラメータ定義
  handler: (args: Record<string, unknown>) => Promise<string> | string
}

interface ToolParameter {
  name: string                    // パラメータ名
  type: 'string' | 'number' | 'boolean' | 'object'  // 型
  description: string             // 説明
  required?: boolean              // 必須かどうか
}
```

## テスト

テスト実装は `tests/services/mcp-server-service` にあります。

### 実行方法

```bash
cd tests/services/mcp-server-service
source ~/.local/share/xs-dev-export.sh
mcconfig -m -d -p lin
```

### テスト用ツール

テストサーバーには以下のツールが実装されています：

- **hello_world**: 挨拶メッセージを返す
- **add_numbers**: 2つの数値を足し算する  
- **get_current_time**: 現在時刻を返す

### テスト例

curlコマンドを使用してヘルスチェック、初期化、ツール実行ができます。

```bash
# ヘルスチェック
curl http://localhost:8080/health

# 初期化
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"initialize","params":{}}'

# ツール実行
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"hello_world","arguments":{"name":"Stack-chan"}}}'
```

### MCPクライアントからの利用

VSCodeとGitHub Copilot(agentモード)を使う場合、 `.vscode/mcp.json` を以下のように設定します：

```json
{
  "servers": {
    "stackchan-mcp": {
      "url": "http://<ｽﾀｯｸﾁｬﾝのIPアドレス>:8080/mcp"
    }
  }
}
```

参考: [Use MCP servers in VS Code](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)


## 技術仕様

- **プロトコル**: Model Context Protocol v2024-11-05
- **トランスポート**: Streamable HTTP
- **メッセージ形式**: JSON-RPC 2.0
- **ポート**: 8080（デフォルト）
- **メモリ効率**: Moddable SDKの制約に最適化

## 参考

- [Model Context Protocol仕様](https://github.com/modelcontextprotocol/specification)
- [MCPサーバー例](https://github.com/modelcontextprotocol/servers)
