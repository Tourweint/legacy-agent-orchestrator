package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.*;
import org.campus.classroom.entity.Notification;

import java.util.List;

public interface NotificationMapper {
    @Insert("""
            INSERT INTO notification (user_id, type, title, content, is_read)
            VALUES (#{userId}, #{type}, #{title}, #{content}, #{isRead})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Notification notification);

    @Select("""
            SELECT id, user_id, type, title, content, is_read, create_time
            FROM notification
            WHERE user_id = #{userId}
            ORDER BY create_time DESC
            LIMIT #{limit}
            """)
    @Results(id = "notificationResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "user_id", property = "userId"),
            @Result(column = "type", property = "type"),
            @Result(column = "title", property = "title"),
            @Result(column = "content", property = "content"),
            @Result(column = "is_read", property = "isRead"),
            @Result(column = "create_time", property = "createTime")
    })
    List<Notification> selectLatestByUserId(@Param("userId") Long userId, @Param("limit") Integer limit);

    @Select("""
            SELECT count(*)
            FROM notification
            WHERE user_id = #{userId}
              AND is_read = 0
            """)
    int countUnread(@Param("userId") Long userId);

    @Update("""
            UPDATE notification
            SET is_read = 1
            WHERE user_id = #{userId}
              AND is_read = 0
            """)
    int markAllRead(@Param("userId") Long userId);
}
