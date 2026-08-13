// 本地端到端测试用的 Redis 兼容服务（miniredis）。
// 仅用于开发/测试环境，生产部署使用真实 Redis。
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/alicebob/miniredis/v2"
)

func main() {
	addr := "127.0.0.1:6379"
	if len(os.Args) > 1 {
		addr = os.Args[1]
	}
	server := miniredis.NewMiniRedis()
	if err := server.StartAddr(addr); err != nil {
		fmt.Fprintf(os.Stderr, "miniredis start failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("miniredis listening on %s\n", addr)

	// miniredis 的逻辑时钟不会自己走，相对 TTL（EXPIRE/SET EX）永不过期。
	// 按真实流逝时间周期推进逻辑时钟，让 TTL 正常过期。
	// FastForward 内部持 miniredis 全局锁（与命令处理同一把），并发安全。
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		last := time.Now()
		for now := range ticker.C {
			server.FastForward(now.Sub(last))
			last = now
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	server.Close()
}
