'use strict';
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '../../campha_moblie');
console.log('Mobile root directory:', mobileRoot);

if (!fs.existsSync(mobileRoot)) {
    console.error('Directory does not exist:', mobileRoot);
    process.exit(1);
}

// 1. Update route_names.dart
const routeNamesPath = path.join(mobileRoot, 'lib/app/router/route_names.dart');
let routeNamesContent = fs.readFileSync(routeNamesPath, 'utf8');
if (!routeNamesContent.includes('notifications =')) {
    routeNamesContent = routeNamesContent.replace(
        "  static const changePassword = 'change-password';",
        "  static const changePassword = 'change-password';\n  static const notifications = 'notifications';"
    );
    routeNamesContent = routeNamesContent.replace(
        "  static const changePassword = '/profile/change-password';",
        "  static const changePassword = '/profile/change-password';\n  static const notifications = '/notifications';"
    );
    fs.writeFileSync(routeNamesPath, routeNamesContent, 'utf8');
    console.log('Updated route_names.dart');
}

// 2. Create notification_model.dart
const notifDir = path.join(mobileRoot, 'lib/features/notifications');
const notifDataDir = path.join(notifDir, 'data');
const notifDomainDir = path.join(notifDir, 'domain');
const notifPresDir = path.join(notifDir, 'presentation');
const notifWidgetsDir = path.join(notifPresDir, 'widgets');

[notifDir, notifDataDir, notifDomainDir, notifPresDir, notifWidgetsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const modelContent = `class NotificationItem {
  final int id;
  final String type;
  final String title;
  final String? body;
  final Map<String, dynamic> data;
  final DateTime? readAt;
  final DateTime createdAt;

  const NotificationItem({
    required this.id,
    required this.type,
    required this.title,
    this.body,
    this.data = const {},
    this.readAt,
    required this.createdAt,
  });

  bool get isRead => readAt != null;

  factory NotificationItem.fromJson(Map<String, dynamic> json) {
    return NotificationItem(
      id: int.tryParse(json['id']?.toString() ?? '') ?? 0,
      type: json['type'] as String? ?? 'general',
      title: json['title'] as String? ?? '',
      body: json['body'] as String?,
      data: json['data'] is Map<String, dynamic>
          ? json['data'] as Map<String, dynamic>
          : (json['data'] is Map
              ? Map<String, dynamic>.from(json['data'] as Map)
              : {}),
      readAt: json['read_at'] != null || json['readAt'] != null
          ? DateTime.tryParse((json['read_at'] ?? json['readAt']).toString())
          : null,
      createdAt: json['created_at'] != null || json['createdAt'] != null
          ? DateTime.tryParse((json['created_at'] ?? json['createdAt']).toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }
}

class NotificationPage {
  final List<NotificationItem> items;
  final int total;

  const NotificationPage({required this.items, required this.total});
}
`;

fs.writeFileSync(path.join(notifDataDir, 'notification_model.dart'), modelContent, 'utf8');
console.log('Created notification_model.dart');

// 3. Create notification_repository.dart with dioProvider
const repoContent = `import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_endpoints.dart';
import '../../../core/network/dio_client.dart';
import 'notification_model.dart';

final notificationRepositoryProvider = Provider<NotificationRepository>((ref) {
  return NotificationRepository(ref.watch(dioProvider));
});

class NotificationRepository {
  final Dio _dio;

  NotificationRepository(this._dio);

  Future<NotificationPage> list({int page = 1, int limit = 20, bool unreadOnly = false}) async {
    final response = await _dio.get<Map<String, dynamic>>(
      ApiEndpoints.notificationsMine,
      queryParameters: {
        'page': page,
        'limit': limit,
        if (unreadOnly) 'unreadOnly': true,
      },
    );
    final data = response.data?['data'];
    final itemsList = (data is List)
        ? data
        : (data is Map && data['items'] is List ? data['items'] as List : []);
    final total = (data is Map && data['total'] != null)
        ? (int.tryParse(data['total'].toString()) ?? itemsList.length)
        : itemsList.length;

    final items = itemsList
        .map((item) => NotificationItem.fromJson(Map<String, dynamic>.from(item as Map)))
        .toList();
    return NotificationPage(items: items, total: total);
  }

  Future<int> unreadCount() async {
    final response = await _dio.get<Map<String, dynamic>>(ApiEndpoints.notificationsUnreadCount);
    final data = response.data?['data'];
    if (data is Map && data['count'] != null) {
      return int.tryParse(data['count'].toString()) ?? 0;
    }
    return 0;
  }

  Future<void> markRead(int id) async {
    await _dio.patch<void>(ApiEndpoints.notificationRead(id));
  }

  Future<void> markAllRead() async {
    await _dio.patch<void>(ApiEndpoints.notificationsReadAll);
  }

  Future<void> delete(int id) async {
    await _dio.delete<void>(ApiEndpoints.notificationDelete(id));
  }
}
`;

fs.writeFileSync(path.join(notifDataDir, 'notification_repository.dart'), repoContent, 'utf8');
console.log('Created notification_repository.dart');

// 4. Create notification_controller.dart
const controllerContent = `import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/notification_model.dart';
import '../data/notification_repository.dart';

final unreadNotificationCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final repository = ref.watch(notificationRepositoryProvider);
  return repository.unreadCount();
});

class NotificationListState {
  final List<NotificationItem> items;
  final bool isLoading;
  final bool isRefreshing;
  final String? errorMessage;
  final bool hasMore;
  final int page;
  final bool unreadOnly;

  const NotificationListState({
    this.items = const [],
    this.isLoading = false,
    this.isRefreshing = false,
    this.errorMessage,
    this.hasMore = true,
    this.page = 1,
    this.unreadOnly = false,
  });

  NotificationListState copyWith({
    List<NotificationItem>? items,
    bool? isLoading,
    bool? isRefreshing,
    String? errorMessage,
    bool? hasMore,
    int? page,
    bool? unreadOnly,
  }) {
    return NotificationListState(
      items: items ?? this.items,
      isLoading: isLoading ?? this.isLoading,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      errorMessage: errorMessage,
      hasMore: hasMore ?? this.hasMore,
      page: page ?? this.page,
      unreadOnly: unreadOnly ?? this.unreadOnly,
    );
  }
}

final notificationListControllerProvider =
    StateNotifierProvider.autoDispose<NotificationListController, NotificationListState>((ref) {
  return NotificationListController(ref.watch(notificationRepositoryProvider), ref);
});

class NotificationListController extends StateNotifier<NotificationListState> {
  final NotificationRepository _repository;
  final Ref _ref;

  NotificationListController(this._repository, this._ref)
      : super(const NotificationListState()) {
    loadInitial();
  }

  Future<void> loadInitial({bool? unreadOnly}) async {
    final filter = unreadOnly ?? state.unreadOnly;
    state = state.copyWith(isLoading: true, errorMessage: null, unreadOnly: filter, page: 1);
    try {
      final page = await _repository.list(page: 1, limit: 20, unreadOnly: filter);
      state = state.copyWith(
        items: page.items,
        isLoading: false,
        hasMore: page.items.length < page.total,
        page: 1,
      );
      _ref.invalidate(unreadNotificationCountProvider);
    } catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.toString());
    }
  }

  Future<void> refresh() async {
    state = state.copyWith(isRefreshing: true, errorMessage: null);
    try {
      final page = await _repository.list(page: 1, limit: 20, unreadOnly: state.unreadOnly);
      state = state.copyWith(
        items: page.items,
        isRefreshing: false,
        hasMore: page.items.length < page.total,
        page: 1,
      );
      _ref.invalidate(unreadNotificationCountProvider);
    } catch (e) {
      state = state.copyWith(isRefreshing: false, errorMessage: e.toString());
    }
  }

  Future<void> loadMore() async {
    if (state.isLoading || !state.hasMore) return;
    final nextPage = state.page + 1;
    try {
      final page = await _repository.list(page: nextPage, limit: 20, unreadOnly: state.unreadOnly);
      state = state.copyWith(
        items: [...state.items, ...page.items],
        page: nextPage,
        hasMore: (state.items.length + page.items.length) < page.total,
      );
    } catch (_) {}
  }

  Future<void> markRead(int id) async {
    try {
      await _repository.markRead(id);
      state = state.copyWith(
        items: state.items.map((item) {
          if (item.id == id) {
            return NotificationItem(
              id: item.id,
              type: item.type,
              title: item.title,
              body: item.body,
              data: item.data,
              readAt: DateTime.now(),
              createdAt: item.createdAt,
            );
          }
          return item;
        }).toList(),
      );
      _ref.invalidate(unreadNotificationCountProvider);
    } catch (_) {}
  }

  Future<void> markAllRead() async {
    try {
      await _repository.markAllRead();
      state = state.copyWith(
        items: state.items.map((item) {
          return NotificationItem(
            id: item.id,
            type: item.type,
            title: item.title,
            body: item.body,
            data: item.data,
            readAt: item.readAt ?? DateTime.now(),
            createdAt: item.createdAt,
          );
        }).toList(),
      );
      _ref.invalidate(unreadNotificationCountProvider);
    } catch (_) {}
  }
}
`;

fs.writeFileSync(path.join(notifDomainDir, 'notification_controller.dart'), controllerContent, 'utf8');
console.log('Created notification_controller.dart');

// 5. Create notifications_screen.dart
const screenContent = `import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router/route_names.dart';
import '../data/notification_model.dart';
import '../domain/notification_controller.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(notificationListControllerProvider);
    final controller = ref.read(notificationListControllerProvider.notifier);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Thông báo'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: 'Đánh dấu tất cả đã đọc',
            icon: const Icon(Icons.done_all_rounded),
            onPressed: () => controller.markAllRead(),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter Chips
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                ChoiceChip(
                  label: const Text('Tất cả'),
                  selected: !state.unreadOnly,
                  onSelected: (selected) {
                    if (selected) controller.loadInitial(unreadOnly: false);
                  },
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('Chưa đọc'),
                  selected: state.unreadOnly,
                  onSelected: (selected) {
                    if (selected) controller.loadInitial(unreadOnly: true);
                  },
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          // Content
          Expanded(
            child: Builder(
              builder: (context) {
                if (state.isLoading && state.items.isEmpty) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (state.errorMessage != null && state.items.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.error_outline_rounded, size: 48, color: theme.colorScheme.error),
                          const SizedBox(height: 12),
                          Text('Không thể tải thông báo', style: theme.textTheme.titleMedium),
                          const SizedBox(height: 8),
                          FilledButton.tonal(
                            onPressed: () => controller.refresh(),
                            child: const Text('Thử lại'),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                if (state.items.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.notifications_off_outlined, size: 64, color: theme.disabledColor),
                        const SizedBox(height: 16),
                        Text(
                          state.unreadOnly ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo nào',
                          style: theme.textTheme.titleMedium?.copyWith(color: theme.disabledColor),
                        ),
                      ],
                    ),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () => controller.refresh(),
                  child: ListView.separated(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: state.items.length + (state.hasMore ? 1 : 0),
                    separatorBuilder: (_, _) => const Divider(height: 1, indent: 64),
                    itemBuilder: (context, index) {
                      if (index >= state.items.length) {
                        controller.loadMore();
                        return const Center(
                          child: Padding(
                            padding: EdgeInsets.all(16),
                            child: SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          ),
                        );
                      }

                      final item = state.items[index];
                      return _NotificationListTile(
                        item: item,
                        onTap: () {
                          if (!item.isRead) {
                            controller.markRead(item.id);
                          }
                          _handleTap(context, item);
                        },
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void _handleTap(BuildContext context, NotificationItem item) {
    final reportId = item.data['reportId']?.toString();
    if (reportId != null && reportId.isNotEmpty && reportId != '0') {
      context.push(RoutePaths.reportDetail(reportId));
    }
  }
}

class _NotificationListTile extends StatelessWidget {
  final NotificationItem item;
  final VoidCallback onTap;

  const _NotificationListTile({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isUnread = !item.isRead;

    IconData iconData = Icons.notifications_rounded;
    Color iconBg = theme.colorScheme.primaryContainer;
    Color iconColor = theme.colorScheme.onPrimaryContainer;

    if (item.type.contains('created')) {
      iconData = Icons.campaign_rounded;
      iconBg = Colors.blue.withValues(alpha: 0.15);
      iconColor = Colors.blue.shade700;
    } else if (item.type.contains('status')) {
      iconData = Icons.sync_problem_rounded;
      iconBg = Colors.orange.withValues(alpha: 0.15);
      iconColor = Colors.orange.shade800;
    }

    return InkWell(
      onTap: onTap,
      child: Container(
        color: isUnread ? theme.colorScheme.primary.withValues(alpha: 0.05) : null,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 20,
              backgroundColor: iconBg,
              child: Icon(iconData, size: 20, color: iconColor),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.title,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: isUnread ? FontWeight.bold : FontWeight.normal,
                          ),
                        ),
                      ),
                      if (isUnread)
                        Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(left: 6),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary,
                            shape: BoxShape.circle,
                          ),
                        ),
                    ],
                  ),
                  if (item.body != null && item.body!.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      item.body!,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.textTheme.bodyMedium?.color?.withValues(alpha: 0.85),
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 6),
                  Text(
                    _formatTime(item.createdAt),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.disabledColor,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 1) return 'Vừa xong';
    if (diff.inMinutes < 60) return '\${diff.inMinutes} phút trước';
    if (diff.inHours < 24) return '\${diff.inHours} giờ trước';
    if (diff.inDays < 7) return '\${diff.inDays} ngày trước';
    return '\${dt.day.toString().padLeft(2, '0')}/\${dt.month.toString().padLeft(2, '0')}/\${dt.year}';
  }
}
`;

fs.writeFileSync(path.join(notifPresDir, 'notifications_screen.dart'), screenContent, 'utf8');
console.log('Created notifications_screen.dart');

// 6. Create notification_bell_button.dart
const bellContent = `import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/route_names.dart';
import '../../domain/notification_controller.dart';

class NotificationBellButton extends ConsumerWidget {
  final Color? color;

  const NotificationBellButton({super.key, this.color});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unreadAsync = ref.watch(unreadNotificationCountProvider);
    final count = unreadAsync.valueOrNull ?? 0;

    return IconButton(
      tooltip: 'Thông báo',
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: Icon(Icons.notifications_outlined, color: color),
      ),
      onPressed: () => context.push(RoutePaths.notifications),
    );
  }
}
`;

fs.writeFileSync(path.join(notifWidgetsDir, 'notification_bell_button.dart'), bellContent, 'utf8');
console.log('Created notification_bell_button.dart');

// 7. Update profile_screen.dart to add NotificationBellButton and ListTile
const profileScreenPath = path.join(mobileRoot, 'lib/features/profile/presentation/profile_screen.dart');
let profileContent = fs.readFileSync(profileScreenPath, 'utf8');
if (!profileContent.includes('notification_bell_button.dart')) {
    profileContent = "import '../../notifications/presentation/widgets/notification_bell_button.dart';\n" + profileContent;
    profileContent = profileContent.replace(
        "SliverAppBar(pinned: true, title: Text(l10n.navProfile)),",
        "SliverAppBar(pinned: true, title: Text(l10n.navProfile), actions: const [NotificationBellButton()]),"
    );
    profileContent = profileContent.replace(
        "Card(\n                        child: ListTile(\n                          key: const ValueKey('profile-my-reports'),",
        `Card(
                        child: Column(
                          children: [
                            ListTile(
                              key: const ValueKey('profile-notifications'),
                              leading: const _ProfileTileIcon(
                                icon: Icons.notifications_outlined,
                              ),
                              title: const Text('Thông báo'),
                              trailing: const Icon(
                                Icons.arrow_forward_ios_rounded,
                                size: 16,
                              ),
                              onTap: () => context.push('/notifications'),
                            ),
                            const Divider(height: 1, indent: 56),
                            ListTile(
                              key: const ValueKey('profile-my-reports'),`
    );
    profileContent = profileContent.replace(
        "onTap: () => context.push('/reports/mine'),\n                        ),\n                      ),",
        "onTap: () => context.push('/reports/mine'),\n                            ),\n                          ],\n                        ),\n                      ),"
    );
    fs.writeFileSync(profileScreenPath, profileContent, 'utf8');
    console.log('Updated profile_screen.dart');
}

// 8. Update my_reports_screen.dart to add NotificationBellButton
const myReportsScreenPath = path.join(mobileRoot, 'lib/features/field_reports/presentation/my_reports_screen.dart');
let myReportsContent = fs.readFileSync(myReportsScreenPath, 'utf8');
if (!myReportsContent.includes('notification_bell_button.dart')) {
    myReportsContent = "import '../../notifications/presentation/widgets/notification_bell_button.dart';\n" + myReportsContent;
    myReportsContent = myReportsContent.replace(
        "appBar: AppBar(title: Text(context.l10n.myReports)),",
        "appBar: AppBar(title: Text(context.l10n.myReports), actions: const [NotificationBellButton()]),"
    );
    fs.writeFileSync(myReportsScreenPath, myReportsContent, 'utf8');
    console.log('Updated my_reports_screen.dart');
}

console.log('All updates completed!');
