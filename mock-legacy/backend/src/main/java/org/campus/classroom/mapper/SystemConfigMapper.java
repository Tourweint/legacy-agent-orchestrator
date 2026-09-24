package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.*;
import org.campus.classroom.entity.SystemConfig;

import java.util.List;

public interface SystemConfigMapper {
    @Select("""
            <script>
            SELECT *
            FROM system_config
            <where>
                <if test="category != null and category != ''">
                    AND category = #{category}
                </if>
            </where>
            ORDER BY category ASC, id ASC
            </script>
            """)
    @Results(id = "systemConfigResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "config_key", property = "configKey"),
            @Result(column = "config_value", property = "configValue"),
            @Result(column = "value_type", property = "valueType"),
            @Result(column = "category", property = "category"),
            @Result(column = "config_name", property = "configName"),
            @Result(column = "description", property = "description"),
            @Result(column = "editable", property = "editable"),
            @Result(column = "create_time", property = "createTime"),
            @Result(column = "update_time", property = "updateTime")
    })
    List<SystemConfig> selectList(@Param("category") String category);

    @Select("""
            SELECT *
            FROM system_config
            WHERE config_key = #{key}
            LIMIT 1
            """)
    @ResultMap("systemConfigResultMap")
    SystemConfig selectByKey(@Param("key") String key);

    @Select("""
            <script>
            SELECT *
            FROM system_config
            WHERE config_key IN
            <foreach collection="keys" item="key" open="(" separator="," close=")">
                #{key}
            </foreach>
            </script>
            """)
    @ResultMap("systemConfigResultMap")
    List<SystemConfig> selectByKeys(@Param("keys") List<String> keys);

    @Update("""
            UPDATE system_config
            SET config_value = #{value}
            WHERE config_key = #{key}
            """)
    int updateValue(@Param("key") String key, @Param("value") String value);
}
